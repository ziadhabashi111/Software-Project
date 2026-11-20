import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import {
  assertCanTransition,
  BookingStatus,
} from '../common/booking-status/booking-status';
import { assertCanAccess } from '../common/security/ownership';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { FlightBookingChangesService } from './flight-booking-changes.service';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import {
  FlightBookingPayments,
  flightRefundIdempotencyKey,
} from './flight-booking-payments';
import { FlightBookingView, FlightBookingViews } from './flight-booking-view';
import { FlightStatus } from '../flights/flight-status';
import {
  airlineRefundAmount,
  CancellationTerms,
  cancellationTerms,
} from './rules/cancellation-rules';
import { allocateRefund, ledgerOf } from './rules/payment-ledger';
import { roundMoney } from './rules/pricing';
import {
  BookingRefund,
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { refundFailureReason } from './refund-failure-reason';
import { SeatAssignments } from './seat-assignments';
import { SeatInventory } from './seat-inventory';
import { SharedServices } from './shared-services';

export interface CancellationResult {
  cancelled: boolean;
  /** The refund for cancelling now (FLT-26; 100% if the airline cancelled a flight). */
  preview: CancellationTerms;
  booking?: FlightBookingView;
  message: string;
}

/**
 * Cancelling a Confirmed booking (FLT-26) and the cascade when an airline
 * cancels a flight (FLT-06). The status change, the refund record and the
 * returned seats commit together; the refund is then issued through Ziad's
 * refund service (PAY-03). A refund failure never undoes the cancellation:
 * the refund is marked Failed with a short reason code instead.
 */
@Injectable()
export class FlightBookingCancellationsService {
  private readonly logger = new Logger(FlightBookingCancellationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    private readonly seats: SeatInventory,
    private readonly expiry: FlightBookingExpiryService,
    private readonly payments: FlightBookingPayments,
    private readonly views: FlightBookingViews,
    private readonly shared: SharedServices,
    private readonly changes: FlightBookingChangesService,
    private readonly seatAssignments: SeatAssignments,
  ) {}

  /** FLT-26: the user's own Confirmed booking, before the outbound departs. */
  async cancel(
    id: string,
    user: AuthUser,
    confirm: boolean,
    now: Date = new Date(),
  ): Promise<CancellationResult> {
    const doc = await this.bookings.findById(id);
    if (!doc) throw new NotFoundException('Booking not found');
    assertCanAccess(doc.user, user);

    const preview = await this.termsFor(doc, now);
    if (!confirm) {
      return {
        cancelled: false,
        preview,
        message: `Cancelling now refunds ${preview.refundAmount} ${doc.currency} (${preview.refundPercent}%). Send { "confirm": true } to cancel.`,
      };
    }

    // FLT-27: a change waiting for payment ends first (its seats released).
    await this.changes.endPendingForBooking(doc._id, now);
    const cancelled = await this.cancelOne(
      doc._id,
      preview.byAirline ? 'airline' : 'user',
      {
        percent: preview.refundPercent,
        amount: preview.refundAmount,
        currency: doc.currency,
      },
      now,
    );
    if (!cancelled) throw notCancellable();
    await this.afterCancel(
      cancelled,
      preview.byAirline ? 'FLIGHT_CANCELLED' : 'FLIGHT_BOOKING_CANCELLED',
      `Your flight booking ${cancelled.reference ?? ''} is cancelled. Refund: ${preview.refundAmount} ${cancelled.currency} (${preview.refundPercent}%).`,
    );
    const fresh = (await this.bookings.findById(doc._id)) ?? cancelled;
    return {
      cancelled: true,
      preview,
      booking: await this.views.bookingView(fresh),
      message: 'The booking is cancelled.',
    };
  }

  /** The cancellation terms of a booking with its flights' current status. */
  async termsFor(
    doc: FlightBookingDocument,
    now: Date = new Date(),
  ): Promise<CancellationTerms> {
    const flights = await this.flights.find({
      _id: { $in: doc.segments.map((s) => s.flight) },
    });
    const byId = new Map(flights.map((f) => [f.id, f]));
    return cancellationTerms(
      {
        status: doc.status,
        total: doc.price.total,
        perSegment: doc.price.perSegment,
        tiers: doc.cancellationTiers,
      },
      doc.segments.map((segment) => {
        const flight = byId.get(segment.flight.toString());
        return {
          departureUtc: flight?.departureUtc ?? new Date(0),
          cancelled: flight?.status === FlightStatus.CANCELLED,
        };
      }),
      now,
    );
  }

  /**
   * FLT-06: the airline cancelled a flight. Pending holds on it expire (GEN-11
   * has no Pending -> Cancelled); Confirmed bookings are cancelled with a 100%
   * refund (only the return leg if the outbound was already flown). Safe to
   * run again: already handled bookings are skipped.
   */
  async cancelForFlight(
    flightId: string,
    now: Date = new Date(),
  ): Promise<{ cancelled: number; notifiedUserIds: string[] }> {
    if (!Types.ObjectId.isValid(flightId)) {
      return { cancelled: 0, notifiedUserIds: [] };
    }
    const id = new Types.ObjectId(flightId);
    // FLT-27: changes holding seats on this flight end too.
    await this.changes.endPendingForFlight(id, now);
    const pending = await this.bookings
      .find({ 'segments.flight': id, status: BookingStatus.PENDING_PAYMENT })
      .select('_id')
      .lean();
    for (const { _id } of pending) {
      await this.expiry.expireOne(_id, now, { force: true });
    }

    const confirmed = await this.bookings.find({
      'segments.flight': id,
      status: BookingStatus.CONFIRMED,
    });
    const notifiedUserIds: string[] = [];
    let count = 0;
    for (const doc of confirmed) {
      const outbound = await this.flights.findById(doc.segments[0].flight);
      const outboundFlown =
        !!outbound && outbound.departureUtc.getTime() <= now.getTime();
      const amount = airlineRefundAmount(
        doc.price.total,
        doc.price.perSegment,
        outboundFlown,
      );
      await this.changes.endPendingForBooking(doc._id, now);
      const cancelled = await this.cancelOne(
        doc._id,
        'airline',
        { percent: 100, amount, currency: doc.currency },
        now,
      );
      if (!cancelled) continue;
      count += 1;
      const userId = cancelled.user.toString();
      await this.afterCancel(
        cancelled,
        'FLIGHT_CANCELLED',
        `The airline cancelled a flight in your booking ${cancelled.reference ?? ''}. Your booking is cancelled and ${amount} ${cancelled.currency} will be refunded in full.`,
      );
      if (!notifiedUserIds.includes(userId)) notifiedUserIds.push(userId);
    }
    return { cancelled: count, notifiedUserIds };
  }

  /**
   * Confirmed -> Cancelled with its refund record, returning the seats of the
   * flights not yet flown, in one transaction. Null if no longer Confirmed.
   */
  private async cancelOne(
    bookingId: Types.ObjectId,
    by: 'user' | 'airline',
    refund: { percent: number; amount: number; currency: string },
    now: Date,
  ): Promise<FlightBookingDocument | null> {
    assertCanTransition(BookingStatus.CONFIRMED, BookingStatus.CANCELLED);
    const amount = roundMoney(refund.amount);
    const record: BookingRefund = {
      percent: refund.percent,
      amount,
      currency: refund.currency,
      ...(amount > 0 ? { status: 'PENDING' as const } : {}),
    };
    return this.connection.transaction(async (session) => {
      // FLT-27: a booking paid with several payments (changed to a dearer
      // flight) is refunded from each, newest first; one payment keeps the
      // single-refund path unchanged.
      const current = await this.bookings
        .findOne({ _id: bookingId, status: BookingStatus.CONFIRMED })
        .session(session);
      if (!current) return null;
      const ledger = ledgerOf(current);
      const split =
        ledger.length > 1 && amount > 0 ? allocateRefund(ledger, amount) : null;
      const doc = await this.bookings.findOneAndUpdate(
        { _id: bookingId, status: BookingStatus.CONFIRMED },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
            cancelledBy: by,
            refund: split
              ? {
                  ...record,
                  parts: split.parts.map((part) => ({
                    ...part,
                    status: 'PENDING' as const,
                  })),
                }
              : record,
            ...(split ? { payments: split.ledger } : {}),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!doc) return null;
      const flights = await this.flights
        .find({ _id: { $in: doc.segments.map((s) => s.flight) } })
        .session(session);
      const notFlown = new Set(
        flights
          .filter((f) => f.departureUtc.getTime() > now.getTime())
          .map((f) => f.id),
      );
      for (const segment of doc.segments) {
        if (!notFlown.has(segment.flight.toString())) continue;
        await this.seats.returnBooked(
          segment.flight,
          segment.cabinClass,
          doc.seats,
          session,
        );
      }
      // FLT-28: the picked seats become free for others.
      await this.seatAssignments.releaseBooking(doc._id, session);
      return doc;
    });
  }

  /** After commit: issue the refund (PAY-03), then notify the user (GEN-01). */
  private async afterCancel(
    doc: FlightBookingDocument,
    type: string,
    message: string,
  ): Promise<void> {
    if ((doc.refund?.amount ?? 0) > 0) await this.issueRefund(doc.id);
    await this.shared.notify(doc.user.toString(), type, message);
  }

  /**
   * Asks the payments module to send the money back (PAY-03). The
   * cancellation itself always stands and the seats stay released:
   * - refund service not wired in this deployment: the refund stays PENDING
   *   (a deploy state, not a failure) and can be issued later;
   * - Stripe / the refund service throws: the refund becomes FAILED with a
   *   short reason code (never a message, stack or secret), shown on the
   *   booking details (FLT-25);
   * - otherwise the result is stored (REFUNDED, or PENDING/FAILED as Stripe
   *   reported it) and any earlier failure reason is cleared.
   */
  private async issueRefund(bookingId: string): Promise<void> {
    const refunds = this.shared.refunds();
    if (!refunds) {
      this.logger.warn(
        `No refund service yet: the refund of flight booking ${bookingId} stays Pending`,
      );
      return;
    }
    const doc = await this.bookings.findById(bookingId);
    if (doc?.refund?.parts?.length) {
      await this.issueRefundParts(doc);
      return;
    }
    try {
      const result = await refunds.issue('flight', bookingId);
      await this.payments.recordRefundResult(bookingId, result);
    } catch (error) {
      const reason = refundFailureReason(error);
      this.logger.error(
        `Refund of flight booking ${bookingId} failed (${reason}); marked Failed`,
      );
      // Only a still-pending refund becomes Failed: never overwrite an
      // outcome a refund webhook may have recorded in the meantime.
      await this.bookings.updateOne(
        {
          _id: new Types.ObjectId(bookingId),
          status: BookingStatus.CANCELLED,
          'refund.status': 'PENDING',
        },
        {
          $set: {
            'refund.status': 'FAILED',
            'refund.failureReason': reason,
          },
        },
      );
    }
  }

  /**
   * FLT-27: one Stripe refund per payment of a changed booking. A part that
   * fails is marked Failed with a short reason; the booking's refund status
   * sums the parts up (see `FlightBookingPayments.recordRefundPart`).
   */
  private async issueRefundParts(doc: FlightBookingDocument): Promise<void> {
    const refunds = this.shared.refunds();
    for (const part of doc.refund?.parts ?? []) {
      if (part.status && part.status !== 'PENDING') continue;
      try {
        if (!refunds?.refundPart) {
          throw new Error('The refund service cannot refund parts');
        }
        const result = await refunds.refundPart({
          kind: 'cancellation_part',
          bookingType: 'flight',
          bookingId: doc.id,
          userId: doc.user.toString(),
          paymentIntentId: part.paymentIntentId,
          amount: part.amount,
          currency: doc.refund?.currency ?? doc.currency,
          percentage: doc.refund?.percent,
          idempotencyKey: `${flightRefundIdempotencyKey(doc.id)}-${part.paymentIntentId}`,
        });
        await this.payments.recordRefundPart(
          doc.id,
          part.paymentIntentId,
          result,
        );
      } catch (error) {
        const reason = refundFailureReason(error);
        this.logger.error(
          `Refund part of flight booking ${doc.id} failed (${reason}); marked Failed`,
        );
        await this.payments.recordRefundPart(doc.id, part.paymentIntentId, {
          status: 'FAILED',
          failureReason: reason,
        });
      }
    }
  }
}

function notCancellable(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'Only a Confirmed booking can be cancelled',
    code: 'NOT_CANCELLABLE',
  });
}
