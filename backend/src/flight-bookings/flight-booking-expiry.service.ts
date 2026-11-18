import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Connection, Model, Types } from 'mongoose';
import {
  assertCanTransition,
  BookingStatus,
} from '../common/booking-status/booking-status';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { SeatInventory } from './seat-inventory';
import { SharedServices } from './shared-services';

/** How often unpaid holds are swept (they are also expired lazily on read). */
export const EXPIRY_SWEEP_MS = 30_000;
/** Bookings handled per sweep, so one run stays short. */
const BATCH = 500;

/**
 * GEN-11 timed transitions:
 * - Pending Payment -> Expired once the 10-minute hold has passed (FLT-22);
 *   the held seats are released and the PaymentIntent cancelled (PAY-01).
 * - Confirmed -> Completed once the booking's last flight has landed.
 * Each change is conditional on the current status, so overlapping sweeps,
 * a lazy expiry and a payment arriving at the same moment are safe.
 */
@Injectable()
export class FlightBookingExpiryService {
  private readonly logger = new Logger(FlightBookingExpiryService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    private readonly seats: SeatInventory,
    private readonly shared: SharedServices,
  ) {}

  @Interval(EXPIRY_SWEEP_MS)
  async sweep(): Promise<void> {
    try {
      await this.expireDue();
      await this.completeDue();
    } catch (error) {
      this.logger.error(
        'Flight booking sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Expires every hold that has run out; returns how many were expired. */
  async expireDue(now: Date = new Date()): Promise<number> {
    const due = await this.bookings
      .find({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .limit(BATCH)
      .lean();
    let expired = 0;
    for (const { _id } of due) {
      if (await this.expireOne(_id, now)) expired += 1;
    }
    return expired;
  }

  /**
   * Pending Payment -> Expired and release the held seats, in one
   * transaction. `force` ignores the hold time (the airline cancelled the
   * flight, FLT-06). Returns false if the booking was no longer pending.
   */
  async expireOne(
    bookingId: Types.ObjectId,
    now: Date = new Date(),
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    assertCanTransition(BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED);
    const expired = await this.connection.transaction(async (session) => {
      const doc = await this.bookings.findOneAndUpdate(
        {
          _id: bookingId,
          status: BookingStatus.PENDING_PAYMENT,
          ...(options.force ? {} : { holdExpiresAt: { $lte: now } }),
        },
        { $set: { status: BookingStatus.EXPIRED, expiredAt: now } },
        { returnDocument: 'after', session },
      );
      if (!doc) return false;
      for (const segment of doc.segments) {
        await this.seats.release(
          segment.flight,
          segment.cabinClass,
          doc.seats,
          session,
        );
      }
      return true;
    });
    if (expired) await this.shared.cancelPendingPayment(bookingId.toString());
    return expired;
  }

  /** Confirmed bookings whose last flight has landed become Completed. */
  async completeDue(now: Date = new Date()): Promise<number> {
    const confirmed = await this.bookings
      .find({ status: BookingStatus.CONFIRMED })
      .select('_id segments.flight')
      .limit(BATCH)
      .lean();
    if (confirmed.length === 0) return 0;
    const flightIds = confirmed.flatMap((b) => b.segments.map((s) => s.flight));
    const landed = new Set(
      (
        await this.flights
          .find({ _id: { $in: flightIds }, arrivalUtc: { $lte: now } })
          .select('_id')
          .lean()
      ).map((f) => f._id.toString()),
    );
    const done = confirmed
      .filter((b) => b.segments.every((s) => landed.has(s.flight.toString())))
      .map((b) => b._id);
    if (done.length === 0) return 0;
    assertCanTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED);
    const result = await this.bookings.updateMany(
      { _id: { $in: done }, status: BookingStatus.CONFIRMED },
      { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
    );
    return result.modifiedCount;
  }
}
