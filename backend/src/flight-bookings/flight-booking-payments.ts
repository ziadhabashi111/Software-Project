import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  assertCanTransition,
  BookingStatus,
} from '../common/booking-status/booking-status';
import { effectiveStatus, FlightStatus } from '../flights/flight-status';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import type { RefundResult } from '../payments/refund.service.interface';
import {
  isDuplicateReference,
  newFlightBookingReference,
} from './booking-reference';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingView, FlightBookingViews } from './flight-booking-view';
import {
  CancellationTerms,
  cancellationTerms,
} from './rules/cancellation-rules';
import { roundMoney } from './rules/pricing';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { SeatInventory } from './seat-inventory';
import { SharedServices } from './shared-services';

/** What the payments module needs to start a PaymentIntent (PAY-01). */
export interface PayableFlightBooking {
  bookingId: string;
  userId: string;
  /** In the platform currency, major units (e.g. 250.5 USD). */
  amount: number;
  currency: string;
  holdExpiresAt: Date;
  description: string;
  /** Set when a PaymentIntent already exists for this hold (retry). */
  paymentIntentId: string | null;
}

/** The Stripe facts the webhook verified (PAY-01). */
export interface VerifiedFlightPayment {
  paymentIntentId: string;
  amount: number;
  currency: string;
}

export type FlightConfirmRejection =
  | 'NOT_FOUND'
  | 'NOT_PENDING'
  | 'HOLD_EXPIRED'
  | 'AMOUNT_MISMATCH'
  | 'FLIGHT_NOT_BOOKABLE';

export type FlightConfirmResult =
  | {
      /**
       * `already_processed`: this same payment was already applied and the
       * booking has moved on (e.g. the user cancelled and got their refund).
       * Do not refund again.
       */
      outcome: 'confirmed' | 'already_confirmed' | 'already_processed';
      booking: FlightBookingView;
    }
  /** Nothing was confirmed: the caller must refund the payment. */
  | { outcome: 'rejected'; reason: FlightConfirmRejection };

/** PAY-02: the airline policies shown and accepted before payment. */
export interface FlightBookingPolicies {
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  baggagePolicy: { extraBagPrice: number; maxExtraBags: number } | null;
  /** Free bags per passenger on each segment. */
  freeBags: number[];
  /** Weight limit per bag on each segment (free and extra bags). */
  maxBagWeightKg: number[];
}

export interface FlightRefundQuote extends CancellationTerms {
  bookingId: string;
  total: number;
  currency: string;
}

/** What the refund service needs for `issue('flight', id)` (PAY-03). */
export interface FlightRefundBasis {
  bookingId: string;
  userId: string;
  paymentIntentId: string;
  amount: number;
  percentage: number;
  currency: string;
  /** PENDING, REFUNDED or FAILED. */
  status: string;
  /**
   * The Stripe refund already created for this cancellation, or `null` if
   * none went out yet. A retrying caller must not create another one when
   * this is set.
   */
  stripeRefundId: string | null;
  /**
   * Stable per booking: pass it as Stripe's `Idempotency-Key` when creating
   * the refund so a retry after a timeout cannot refund twice.
   */
  idempotencyKey: string;
  /** Why the last attempt failed (a short code, no secrets), when FAILED. */
  failureReason: string | null;
}

/** The Stripe idempotency key for the refund of one flight booking (PAY-03). */
export function flightRefundIdempotencyKey(bookingId: string): string {
  return `flight-booking-refund-${bookingId}`;
}

type ConfirmAttempt =
  | { outcome: 'confirmed'; booking: FlightBookingDocument }
  | { outcome: 'already_confirmed'; booking: FlightBookingDocument }
  | { outcome: 'already_processed'; booking: FlightBookingDocument }
  | { outcome: 'rejected'; reason: FlightConfirmRejection };

const REFERENCE_ATTEMPTS = 3;

/**
 * The flight side of payments, for the payments module (Ziad). Same method
 * names and shapes as hotel bookings' `HotelReservationPayments`:
 * `forPayment` / `attachPaymentIntent` / `recordPaymentFailure` while paying,
 * `confirmPaid` from the verified Stripe webhook only (PAY-01, FLT-23),
 * `policiesFor` for PAY-02, and `refundQuote` / `refundBasis` /
 * `recordRefundResult` for the refund service (PAY-03).
 */
@Injectable()
export class FlightBookingPayments {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    private readonly seats: SeatInventory,
    private readonly expiry: FlightBookingExpiryService,
    private readonly views: FlightBookingViews,
    private readonly shared: SharedServices,
  ) {}

  /**
   * The amount to charge for the user's own live hold. 404 when it is not
   * theirs; 409 NOT_PAYABLE once it is expired, paid or cancelled.
   */
  async forPayment(
    bookingId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<PayableFlightBooking> {
    const doc = await this.findOwned(bookingId, userId);
    if (
      doc.status === BookingStatus.PENDING_PAYMENT &&
      doc.holdExpiresAt &&
      doc.holdExpiresAt.getTime() <= now.getTime()
    ) {
      await this.expiry.expireOne(doc._id, now);
      throw notPayable('The 10-minute hold has expired. Start a new booking.');
    }
    if (doc.status !== BookingStatus.PENDING_PAYMENT || !doc.holdExpiresAt) {
      throw notPayable('This booking is not waiting for payment.');
    }
    return {
      bookingId: doc.id,
      userId: doc.user.toString(),
      amount: doc.price.total,
      currency: doc.currency,
      holdExpiresAt: doc.holdExpiresAt,
      description: `Flight booking ${doc.id} (${doc.tripType}, ${doc.passengers.length} passenger${doc.passengers.length === 1 ? '' : 's'})`,
      paymentIntentId: doc.payment?.paymentIntentId ?? null,
    };
  }

  /** Remembers the PaymentIntent created for this hold, so a retry reuses it. */
  async attachPaymentIntent(
    bookingId: string,
    paymentIntentId: string,
  ): Promise<void> {
    const doc = await this.bookings.findOne({
      _id: toObjectId(bookingId),
      status: BookingStatus.PENDING_PAYMENT,
    });
    if (!doc) throw notPayable('This booking is not waiting for payment.');
    await this.bookings.updateOne(
      { _id: doc._id, status: BookingStatus.PENDING_PAYMENT },
      {
        $set: {
          payment: {
            paymentIntentId,
            amount: doc.price.total,
            currency: doc.currency,
            status: 'PENDING',
          },
        },
      },
    );
  }

  /** PAY-01: a failed attempt; the user may retry until the hold expires. */
  async recordPaymentFailure(bookingId: string): Promise<void> {
    await this.bookings.updateOne(
      { _id: toObjectId(bookingId), status: BookingStatus.PENDING_PAYMENT },
      { $set: { 'payment.status': 'FAILED' } },
    );
  }

  /**
   * Called only after the backend verified the PaymentIntent succeeded
   * (webhook). In one transaction: Pending Payment -> Confirmed, held seats ->
   * booked seats, unique reference. Idempotent for the same PaymentIntent.
   * Rejects (so the caller refunds) a late, wrong-amount or no-longer-bookable
   * payment; such a hold is ended and its seats released.
   */
  async confirmPaid(
    bookingId: string,
    paid: VerifiedFlightPayment,
    now: Date = new Date(),
  ): Promise<FlightConfirmResult> {
    if (!Types.ObjectId.isValid(bookingId)) {
      return { outcome: 'rejected', reason: 'NOT_FOUND' };
    }
    const id = new Types.ObjectId(bookingId);
    let attempt: ConfirmAttempt | undefined;
    for (let i = 0; i < REFERENCE_ATTEMPTS && !attempt; i += 1) {
      try {
        attempt = await this.confirmOnce(id, paid, now);
      } catch (error) {
        if (!isDuplicateReference(error) || i === REFERENCE_ATTEMPTS - 1) {
          throw error;
        }
      }
    }
    if (!attempt) throw new InternalServerErrorException();

    if (attempt.outcome === 'rejected') {
      if (
        attempt.reason === 'HOLD_EXPIRED' ||
        attempt.reason === 'FLIGHT_NOT_BOOKABLE'
      ) {
        await this.expiry.expireOne(id, now, { force: true });
      }
      return attempt;
    }
    const view = await this.views.bookingView(attempt.booking);
    if (attempt.outcome === 'confirmed') {
      await this.shared.notify(
        attempt.booking.user.toString(),
        'FLIGHT_BOOKING_CONFIRMED',
        confirmationMessage(view),
      );
    }
    return { outcome: attempt.outcome, booking: view };
  }

  /** PAY-02: the policies of the user's own booking, as accepted at hold time. */
  async policiesFor(
    bookingId: string,
    userId: string,
  ): Promise<FlightBookingPolicies> {
    const doc = await this.findOwned(bookingId, userId);
    return {
      cancellationTiers: doc.cancellationTiers.map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
      baggagePolicy: doc.baggagePolicy
        ? {
            extraBagPrice: doc.baggagePolicy.extraBagPrice,
            maxExtraBags: doc.baggagePolicy.maxExtraBags,
          }
        : null,
      freeBags: doc.segments.map((s) => s.freeBags),
      maxBagWeightKg: doc.segments.map((s) => s.maxBagWeightKg),
    };
  }

  /**
   * PAY-03 / FLT-26: what cancelling now would refund (outbound airline's
   * tiers on the full total). `null` unless the booking can be cancelled.
   */
  async refundQuote(
    bookingId: string,
    now: Date = new Date(),
  ): Promise<FlightRefundQuote | null> {
    if (!Types.ObjectId.isValid(bookingId)) return null;
    const doc = await this.bookings.findById(bookingId);
    if (!doc || doc.status !== BookingStatus.CONFIRMED) return null;
    const flights = await this.flights.find({
      _id: { $in: doc.segments.map((s) => s.flight) },
    });
    const byId = new Map(flights.map((f) => [f.id, f]));
    if (
      byId.size !== new Set(doc.segments.map((s) => s.flight.toString())).size
    ) {
      return null;
    }
    try {
      return {
        bookingId: doc.id,
        total: doc.price.total,
        currency: doc.currency,
        ...cancellationTerms(
          {
            status: doc.status,
            total: doc.price.total,
            perSegment: doc.price.perSegment,
            tiers: doc.cancellationTiers,
          },
          doc.segments.map((s) => {
            const flight = byId.get(s.flight.toString());
            return {
              departureUtc: flight!.departureUtc,
              cancelled: flight!.status === FlightStatus.CANCELLED,
            };
          }),
          now,
        ),
      };
    } catch {
      return null;
    }
  }

  /**
   * PAY-03, for `RefundService.issue('flight', id)`: the amount fixed when the
   * booking was cancelled and the PaymentIntent to refund. `null` unless it
   * was cancelled with a refund to pay.
   */
  async refundBasis(bookingId: string): Promise<FlightRefundBasis | null> {
    if (!Types.ObjectId.isValid(bookingId)) return null;
    const doc = await this.bookings.findById(bookingId);
    if (
      !doc ||
      doc.status !== BookingStatus.CANCELLED ||
      !doc.refund?.status ||
      !doc.payment?.paymentIntentId
    ) {
      return null;
    }
    return {
      bookingId: doc.id,
      userId: doc.user.toString(),
      paymentIntentId: doc.payment.paymentIntentId,
      amount: doc.refund.amount,
      percentage: doc.refund.percent,
      currency: doc.refund.currency,
      status: doc.refund.status,
      stripeRefundId: doc.refund.refundId ?? null,
      idempotencyKey: flightRefundIdempotencyKey(doc.id),
      failureReason: doc.refund.failureReason ?? null,
    };
  }

  /** Stores the refund outcome, e.g. from a Stripe refund webhook (PAY-03). */
  async recordRefundResult(
    bookingId: string,
    result: RefundResult,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(bookingId)) return false;
    const updated = await this.bookings.updateOne(
      {
        _id: new Types.ObjectId(bookingId),
        status: BookingStatus.CANCELLED,
        refund: { $exists: true },
      },
      {
        $set: {
          'refund.refundId': result.refundId,
          'refund.status': result.status,
        },
        $unset: { 'refund.failureReason': 1 },
      },
    );
    return updated.matchedCount === 1;
  }

  private async confirmOnce(
    id: Types.ObjectId,
    paid: VerifiedFlightPayment,
    now: Date,
  ): Promise<ConfirmAttempt> {
    const reference = newFlightBookingReference();
    return this.connection.transaction(async (session) => {
      const doc = await this.bookings.findById(id).session(session);
      if (!doc) return { outcome: 'rejected', reason: 'NOT_FOUND' };
      if (doc.status !== BookingStatus.PENDING_PAYMENT) {
        // A replayed webhook for a payment already applied must never be
        // refunded again, whatever happened to the booking since.
        const samePayment =
          doc.payment?.paymentIntentId === paid.paymentIntentId &&
          doc.payment?.status === 'SUCCEEDED';
        if (!samePayment) return { outcome: 'rejected', reason: 'NOT_PENDING' };
        return doc.status === BookingStatus.CONFIRMED ||
          doc.status === BookingStatus.COMPLETED
          ? { outcome: 'already_confirmed', booking: doc }
          : { outcome: 'already_processed', booking: doc };
      }
      if (!doc.holdExpiresAt || doc.holdExpiresAt.getTime() <= now.getTime()) {
        return { outcome: 'rejected', reason: 'HOLD_EXPIRED' };
      }
      if (
        roundMoney(paid.amount) !== doc.price.total ||
        paid.currency.toUpperCase() !== doc.currency.toUpperCase()
      ) {
        return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH' };
      }
      if (!(await this.flightsStillBookable(doc, now, session))) {
        return { outcome: 'rejected', reason: 'FLIGHT_NOT_BOOKABLE' };
      }

      assertCanTransition(doc.status, BookingStatus.CONFIRMED);
      const confirmed = await this.bookings.findOneAndUpdate(
        { _id: id, status: BookingStatus.PENDING_PAYMENT },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            confirmedAt: now,
            reference,
            payment: {
              paymentIntentId: paid.paymentIntentId,
              amount: doc.price.total,
              currency: doc.currency,
              status: 'SUCCEEDED',
            },
          },
        },
        { returnDocument: 'after', session },
      );
      if (!confirmed) return { outcome: 'rejected', reason: 'NOT_PENDING' };
      for (const segment of confirmed.segments) {
        const moved = await this.seats.confirm(
          segment.flight,
          segment.cabinClass,
          confirmed.seats,
          session,
        );
        if (!moved) {
          // Held seats are missing: never confirm without them.
          throw new InternalServerErrorException(
            'Seat inventory is inconsistent for this booking',
          );
        }
      }
      return { outcome: 'confirmed', booking: confirmed };
    });
  }

  private async flightsStillBookable(
    doc: FlightBookingDocument,
    now: Date,
    session: ClientSession,
  ): Promise<boolean> {
    const flights = await this.flights
      .find({ _id: { $in: doc.segments.map((s) => s.flight) } })
      .session(session);
    return (
      flights.length === doc.segments.length &&
      flights.every(
        (f) =>
          effectiveStatus(f, now) === FlightStatus.SCHEDULED &&
          f.departureUtc.getTime() > now.getTime(),
      )
    );
  }

  private async findOwned(
    bookingId: string,
    userId: string,
  ): Promise<FlightBookingDocument> {
    const doc = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId)
      : null;
    if (!doc || doc.user.toString() !== userId) {
      throw new NotFoundException('Booking not found');
    }
    return doc;
  }
}

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Booking not found');
  }
  return new Types.ObjectId(id);
}

function notPayable(message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code: 'NOT_PAYABLE',
  });
}

/** FLT-23: the in-app notification with the booking details. */
function confirmationMessage(view: FlightBookingView): string {
  const flights = view.segments
    .map(
      (s) =>
        `${s.flightNumber} ${s.departure.airport.iataCode}-${s.arrival.airport.iataCode} on ${s.departure.localDate} at ${s.departure.localTime} (local time)`,
    )
    .join('; ');
  return `Your flight booking ${view.reference ?? ''} is confirmed: ${flights}. Total paid ${view.price.total} ${view.currency}. Your e-ticket is ready to download.`;
}
