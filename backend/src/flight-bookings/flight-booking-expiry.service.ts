import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Connection, Model, Types } from 'mongoose';
import {
  assertCanTransition,
  BookingStatus,
} from '../common/booking-status/booking-status';
import { STRIPE_WEBHOOK_RETRY_MS } from '../common/booking-status/hold';
import { FlightStatus } from '../flights/flight-status';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { SeatAssignments } from './seat-assignments';
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
    private readonly seatAssignments: SeatAssignments,
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
    if (!options.force && !(await this.paymentCancelled(bookingId, now))) {
      return false;
    }
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
      // FLT-28: a hold cannot pick seats, but never leave any behind.
      await this.seatAssignments.releaseBooking(doc._id, session);
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
    // A forced expiry (the flight was cancelled) ends the hold first, then
    // stops the payment; a late success is refunded by the webhook.
    if (expired && options.force) {
      await this.shared.cancelPendingPayment(bookingId.toString());
    }
    return expired;
  }

  /**
   * Before a run-out hold expires, its PaymentIntent is cancelled. If Stripe
   * says the user already paid (in the last seconds of the hold), the hold is
   * left alone: the webhook confirms the booking, or refunds the payment
   * (FLT-22, PAY-01). Once Stripe has stopped retrying webhooks the hold is
   * expired anyway, so seats are never held forever. False when the booking
   * is not a run-out hold.
   */
  private async paymentCancelled(
    bookingId: Types.ObjectId,
    now: Date,
  ): Promise<boolean> {
    const due = await this.bookings
      .findOne({
        _id: bookingId,
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
      })
      .select('holdExpiresAt')
      .lean();
    if (!due?.holdExpiresAt) return false;
    const payment = await this.shared.cancelPendingPayment(
      bookingId.toString(),
    );
    if (payment !== 'not_cancellable') return true;
    return (
      now.getTime() - due.holdExpiresAt.getTime() >= STRIPE_WEBHOOK_RETRY_MS
    );
  }

  /**
   * Confirmed bookings whose last flight has landed become Completed. Pages
   * through every Confirmed booking (by `_id`, `batchSize` at a time), so
   * upcoming bookings never hide landed ones behind a fixed limit.
   */
  async completeDue(
    now: Date = new Date(),
    batchSize: number = BATCH,
  ): Promise<number> {
    let completed = 0;
    let after: Types.ObjectId | undefined;
    for (;;) {
      const page = await this.bookings
        .find({
          status: BookingStatus.CONFIRMED,
          ...(after ? { _id: { $gt: after } } : {}),
        })
        .select('_id segments.flight')
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean();
      if (page.length === 0) return completed;
      completed += await this.completeLanded(page, now);
      if (page.length < batchSize) return completed;
      after = page[page.length - 1]._id;
    }
  }

  private async completeLanded(
    confirmed: {
      _id: Types.ObjectId;
      segments: { flight: Types.ObjectId }[];
    }[],
    now: Date,
  ): Promise<number> {
    const flightIds = confirmed.flatMap((b) => b.segments.map((s) => s.flight));
    const landed = new Set(
      (
        await this.flights
          .find({
            _id: { $in: flightIds },
            arrivalUtc: { $lte: now },
            // A flight the airline cancelled never flew (FLT-06 refunds it).
            status: { $ne: FlightStatus.CANCELLED },
          })
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
