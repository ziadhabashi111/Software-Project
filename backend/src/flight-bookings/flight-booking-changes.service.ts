import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { BookingStatus } from '../common/booking-status/booking-status';
import {
  holdExpiredMessage,
  holdExpiresAt,
  STRIPE_WEBHOOK_RETRY_MS,
} from '../common/booking-status/hold';
import { fieldError } from '../common/validation/validation-errors';
import { effectiveStatus, FlightStatus } from '../flights/flight-status';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import {
  FINAL_REFUND_STATUSES,
  type RefundResult,
} from '../payments/refund.service.interface';
import { ChangeFlightDto } from './dto/change-flight.dto';
import {
  FlightBookingPayments,
  FlightBookingPolicies,
  FlightConfirmRejection,
  PayableFlightBooking,
  VerifiedFlightPayment,
} from './flight-booking-payments';
import {
  SegmentView,
  FlightBookingView,
  FlightBookingViews,
} from './flight-booking-view';
import { refundFailureReason } from './refund-failure-reason';
import { assertBaggage } from './rules/baggage-rules';
import { classifyPassengers } from './rules/passenger-rules';
import {
  allocateRefund,
  LedgerEntry,
  ledgerOf,
  RefundPart,
} from './rules/payment-ledger';
import {
  BookingPriceBreakdown,
  priceBooking,
  roundMoney,
} from './rules/pricing';
import {
  ChangedSegment,
  FlightBookingChange,
  FlightBookingChangeDocument,
} from './schemas/flight-booking-change.schema';
import {
  BookedSegment,
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { SeatInventory } from './seat-inventory';
import { SharedServices } from './shared-services';
import { SeatAssignments } from './seat-assignments';

/** Expired changes handled per sweep run. */
const SWEEP_BATCH = 500;

export type ChangeAction = 'pay' | 'refund' | 'none';

/** The answer of `PATCH /flight-bookings/:id/change-flight` (FLT-27). */
export interface FlightChangeView {
  /** True once the booking flies the new flight. */
  changed: boolean;
  action: ChangeAction;
  segmentIndex: number;
  newFlight: SegmentView;
  currentSegmentTotal: number;
  newSegmentTotal: number;
  /** newSegmentTotal - currentSegmentTotal: paid when positive, refunded when negative. */
  difference: number;
  newTotal: number;
  currency: string;
  /** The change record (also what to pay, as bookingType `flight-change`). */
  changeId?: string;
  holdExpiresAt?: Date;
  booking?: FlightBookingView;
  message: string;
}

/** A validated change, priced with the terms in force now. */
interface PreparedChange {
  booking: FlightBookingDocument;
  segmentIndex: number;
  fromFlight: FlightDocument;
  flight: FlightDocument;
  airline: AirlineDocument;
  segment: ChangedSegment;
  price: BookingPriceBreakdown;
  currentSegmentTotal: number;
  newSegmentTotal: number;
  difference: number;
}

type ChangeConfirmAttempt =
  | {
      outcome: 'confirmed';
      change: FlightBookingChangeDocument;
      booking: FlightBookingDocument;
    }
  | { outcome: 'already_confirmed' | 'already_processed' }
  | { outcome: 'rejected'; reason: FlightConfirmRejection };

export type ChangeConfirmResult =
  | { outcome: 'confirmed' | 'already_confirmed' | 'already_processed' }
  | { outcome: 'rejected'; reason: FlightConfirmRejection };

/**
 * FLT-27: change a Confirmed booking's outbound or return to another flight
 * of the same airline, route and cabin. A same-fare or cheaper change is
 * applied at once (a lower fare is refunded to the card); a dearer one holds
 * the new seats and waits for its difference to be paid through the payments
 * module (bookingType `flight-change`), whose verified webhook applies it.
 */
@Injectable()
export class FlightBookingChangesService {
  private readonly logger = new Logger(FlightBookingChangesService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(FlightBookingChange.name)
    private readonly changes: Model<FlightBookingChangeDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly seats: SeatInventory,
    private readonly views: FlightBookingViews,
    private readonly payments: FlightBookingPayments,
    private readonly shared: SharedServices,
    private readonly seatAssignments: SeatAssignments,
  ) {}

  /** Preview (confirm = false) or make the change of the user's own booking. */
  async change(
    bookingId: string,
    user: AuthUser,
    dto: ChangeFlightDto,
    confirm: boolean,
    now: Date = new Date(),
  ): Promise<FlightChangeView> {
    const doc = Types.ObjectId.isValid(bookingId)
      ? await this.bookings.findById(bookingId)
      : null;
    if (!doc || doc.user.toString() !== user.id) {
      throw new NotFoundException('Booking not found');
    }
    const prepared = await this.prepare(doc, dto, now);
    if (!confirm) {
      return this.view(prepared, {
        changed: false,
        message:
          prepared.difference > 0
            ? `Changing costs ${prepared.difference} ${doc.currency} more. Send ?confirm=true to hold the new seats, then pay the difference.`
            : prepared.difference < 0
              ? `Changing refunds ${-prepared.difference} ${doc.currency}. Send ?confirm=true to change.`
              : 'The new flight costs the same. Send ?confirm=true to change.',
      });
    }
    if (prepared.difference > 0) {
      const change = await this.holdDearer(prepared, now);
      return this.view(
        { ...prepared, difference: change.difference },
        {
          changed: false,
          changeId: change.id,
          holdExpiresAt: change.holdExpiresAt,
          message: `The new seats are held. Pay ${change.difference} ${doc.currency} with POST /api/payments { "bookingType": "flight-change", "bookingId": "${change.id}" } before the hold ends.`,
        },
      );
    }
    const { booking, change } = await this.applyNow(prepared, now);
    await this.refundDifference(change);
    await this.notifyChanged(booking);
    return this.view(
      { ...prepared, difference: change.difference },
      {
        changed: true,
        changeId: change.id,
        booking: await this.views.bookingView(booking),
        message:
          change.difference < 0
            ? `Your booking is changed. ${-change.difference} ${doc.currency} is refunded to your card.`
            : 'Your booking is changed.',
      },
    );
  }

  // ------------------------------------------------------- payments module

  /** The fare difference to pay for the user's own pending change (PAY-01). */
  async forPayment(
    changeId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<PayableFlightBooking> {
    const change = await this.findOwned(changeId, userId);
    if (
      change.status === BookingStatus.PENDING_PAYMENT &&
      change.holdExpiresAt &&
      change.holdExpiresAt.getTime() <= now.getTime()
    ) {
      await this.expire(change._id, now);
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: holdExpiredMessage(),
        code: 'HOLD_EXPIRED',
      });
    }
    if (
      change.status !== BookingStatus.PENDING_PAYMENT ||
      !change.holdExpiresAt
    ) {
      throw notPayable();
    }
    return {
      bookingId: change.id,
      userId: change.user.toString(),
      amount: change.difference,
      currency: change.currency,
      holdExpiresAt: change.holdExpiresAt,
      description: `Flight change of booking ${change.booking.toString()} (fare difference)`,
      paymentIntentId: change.payment?.paymentIntentId ?? null,
    };
  }

  /** Remembers the PaymentIntent of a pending change, so a retry reuses it. */
  async attachPaymentIntent(
    changeId: string,
    paymentIntentId: string,
  ): Promise<void> {
    const updated = await this.changes.updateOne(
      { _id: toObjectId(changeId), status: BookingStatus.PENDING_PAYMENT },
      { $set: { payment: { paymentIntentId, status: 'PENDING' } } },
    );
    if (updated.matchedCount === 0) throw notPayable();
  }

  /** PAY-01: a failed attempt; the user may retry until the hold ends. */
  async recordPaymentFailure(changeId: string): Promise<void> {
    await this.changes.updateOne(
      { _id: toObjectId(changeId), status: BookingStatus.PENDING_PAYMENT },
      { $set: { 'payment.status': 'FAILED' } },
    );
  }

  /** PAY-02: the change keeps the original booking's accepted policies. */
  async policiesFor(
    changeId: string,
    userId: string,
  ): Promise<FlightBookingPolicies> {
    const change = await this.findOwned(changeId, userId);
    return this.payments.policiesFor(change.booking.toString(), userId);
  }

  /** The booking whose accepted policies cover this change (PAY-02). */
  async bookingOf(changeId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(changeId)) return null;
    const change = await this.changes
      .findById(changeId)
      .select('booking')
      .lean();
    return change ? change.booking.toString() : null;
  }

  /**
   * From the verified webhook only (PAY-01): applies a paid dearer change in
   * one transaction. `rejected` (late, wrong amount, booking moved on, flight
   * no longer bookable) ends the change and makes the caller refund.
   */
  async confirmPaid(
    changeId: string,
    paid: VerifiedFlightPayment,
    now: Date = new Date(),
  ): Promise<ChangeConfirmResult> {
    if (!Types.ObjectId.isValid(changeId)) {
      return { outcome: 'rejected', reason: 'NOT_FOUND' };
    }
    const id = new Types.ObjectId(changeId);
    const attempt = await this.confirmOnce(id, paid, now);
    if (attempt.outcome === 'rejected') {
      // Like a booking hold: a late payment, a booking that moved on or a
      // flight no longer bookable ends the change; the caller refunds.
      if (
        attempt.reason === 'HOLD_EXPIRED' ||
        attempt.reason === 'NOT_PENDING' ||
        attempt.reason === 'FLIGHT_NOT_BOOKABLE'
      ) {
        await this.expire(id, now, { force: true });
      }
      return attempt;
    }
    if (attempt.outcome === 'confirmed') {
      await this.notifyChanged(attempt.booking);
      return { outcome: 'confirmed' };
    }
    return { outcome: attempt.outcome };
  }

  /** A fare-difference refund's outcome, e.g. from the refund webhook (PAY-03). */
  async recordRefundResult(
    changeId: string,
    result: RefundResult,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(changeId)) return false;
    const pending = result.status === 'PENDING';
    const updated = await this.changes.updateOne(
      {
        _id: new Types.ObjectId(changeId),
        refunds: {
          $elemMatch: {
            refundId: result.refundId,
            ...(pending ? { status: { $nin: FINAL_REFUND_STATUSES } } : {}),
          },
        },
      },
      {
        $set: {
          'refunds.$.status': result.status,
          ...(result.failureReason
            ? { 'refunds.$.failureReason': result.failureReason }
            : {}),
        },
      },
    );
    return updated.matchedCount === 1;
  }

  // ------------------------------------------------------------- endings

  /** GEN-11: unpaid changes whose hold ran out release their seats. */
  @Interval('flight-change-expiry', 30_000)
  async expireDueChanges(now: Date = new Date()): Promise<number> {
    const due = await this.changes
      .find({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $lte: now },
      })
      .select('_id')
      .limit(SWEEP_BATCH)
      .lean();
    let expired = 0;
    for (const { _id } of due) {
      try {
        if (await this.expire(_id, now)) expired += 1;
      } catch (error) {
        this.logger.error(
          `Could not expire flight change ${_id.toString()}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  /** The booking is being cancelled: its pending change ends first. */
  async endPendingForBooking(
    bookingId: Types.ObjectId,
    now: Date = new Date(),
  ): Promise<void> {
    const pending = await this.changes
      .findOne({ booking: bookingId, status: BookingStatus.PENDING_PAYMENT })
      .select('_id')
      .lean();
    if (pending) await this.expire(pending._id, now, { force: true });
  }

  /** FLT-06: the airline cancelled a flight that pending changes hold seats on. */
  async endPendingForFlight(
    flightId: Types.ObjectId,
    now: Date = new Date(),
  ): Promise<void> {
    const pending = await this.changes
      .find({
        'segment.flight': flightId,
        status: BookingStatus.PENDING_PAYMENT,
      })
      .select('_id')
      .lean();
    for (const { _id } of pending) {
      await this.expire(_id, now, { force: true });
    }
  }

  /**
   * Pending -> Expired and the held seats released, in one transaction. A
   * run-out change whose payment Stripe already took is left to the webhook
   * (same guard as holds) until Stripe stops retrying. `force` ends it at
   * once (booking cancelled, flight cancelled, payment rejected).
   */
  private async expire(
    changeId: Types.ObjectId,
    now: Date,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    if (!options.force) {
      const due = await this.changes
        .findOne({
          _id: changeId,
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $lte: now },
        })
        .select('holdExpiresAt')
        .lean();
      if (!due?.holdExpiresAt) return false;
      const payment = await this.shared.cancelPendingPayment(
        changeId.toString(),
        'flight-change',
      );
      if (
        payment === 'not_cancellable' &&
        now.getTime() - due.holdExpiresAt.getTime() < STRIPE_WEBHOOK_RETRY_MS
      ) {
        return false;
      }
    }
    const expired = await this.connection.transaction(async (session) => {
      const change = await this.changes.findOneAndUpdate(
        {
          _id: changeId,
          status: BookingStatus.PENDING_PAYMENT,
          ...(options.force ? {} : { holdExpiresAt: { $lte: now } }),
        },
        { $set: { status: BookingStatus.EXPIRED, expiredAt: now } },
        { returnDocument: 'after', session },
      );
      if (!change) return false;
      await this.seats.release(
        change.segment.flight,
        change.segment.cabinClass,
        change.seats,
        session,
      );
      return true;
    });
    if (expired && options.force) {
      await this.shared.cancelPendingPayment(
        changeId.toString(),
        'flight-change',
      );
    }
    return expired;
  }

  // -------------------------------------------------------------- inside

  /** Validates the change and prices it with the terms in force now. */
  private async prepare(
    doc: FlightBookingDocument,
    dto: ChangeFlightDto,
    now: Date,
  ): Promise<PreparedChange> {
    const segmentIndex = dto.segmentIndex ?? 0;
    if (segmentIndex >= doc.segments.length) {
      throw fieldError('segmentIndex', 'This booking has no return flight');
    }
    if (doc.status !== BookingStatus.CONFIRMED) {
      throw notChangeable('Only a Confirmed booking can be changed');
    }
    if (
      await this.changes.exists({
        booking: doc._id,
        status: BookingStatus.PENDING_PAYMENT,
      })
    ) {
      throw changePending();
    }
    const current = doc.segments[segmentIndex];
    const fromFlight = await this.flights.findById(current.flight);
    if (
      !fromFlight ||
      effectiveStatus(fromFlight, now) !== FlightStatus.SCHEDULED ||
      fromFlight.departureUtc.getTime() <= now.getTime()
    ) {
      throw notChangeable(
        'This flight has departed or was cancelled, so it cannot be changed',
      );
    }

    const flight = await this.flights.findById(dto.flightId);
    if (!flight) throw fieldError('flightId', 'Flight not found');
    if (flight.id === fromFlight.id) {
      throw fieldError('flightId', 'This is already your flight');
    }
    if (flight.airlineId.toString() !== fromFlight.airlineId.toString()) {
      throw fieldError('flightId', 'Choose a flight of the same airline');
    }
    if (
      flight.departureAirport !== fromFlight.departureAirport ||
      flight.arrivalAirport !== fromFlight.arrivalAirport
    ) {
      throw fieldError(
        'flightId',
        `Choose a flight on the same route (${fromFlight.departureAirport} to ${fromFlight.arrivalAirport})`,
      );
    }
    const status = effectiveStatus(flight, now);
    if (
      status !== FlightStatus.SCHEDULED ||
      flight.departureUtc.getTime() <= now.getTime()
    ) {
      throw fieldError(
        'flightId',
        `This flight cannot be booked (it is ${status})`,
      );
    }
    const airline = await this.airlines.findById(flight.airlineId);
    if (!airline?.isActive) {
      throw fieldError('flightId', 'This airline is not accepting bookings');
    }
    const cabin = flight.cabins.find(
      (c) => c.cabinClass === current.cabinClass,
    );
    if (!cabin) {
      throw fieldError(
        'flightId',
        `This flight has no ${current.cabinClass} cabin`,
      );
    }
    await this.assertKeepsOrder(doc, segmentIndex, flight);

    if (segmentIndex === 0) {
      // FLT-12b: types follow the outbound's local departure date.
      classifyPassengers(
        doc.passengers.map((p) => ({
          type: p.type,
          dateOfBirth: p.dateOfBirth,
        })),
        flight.departureLocalDate,
        now,
      );
    }
    doc.passengers.forEach((p, i) =>
      assertBaggage(
        i,
        p.extraBags,
        p.extraBagWeightKg,
        airline.baggagePolicy ?? undefined,
        cabin.maxBagWeightKg,
      ),
    );
    if (cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats < doc.seats) {
      throw seatsUnavailable(flight.flightNumber);
    }
    return this.priced(doc, segmentIndex, fromFlight, flight, airline);
  }

  /** The round trip stays in order: the outbound lands before the return leaves. */
  private async assertKeepsOrder(
    doc: FlightBookingDocument,
    segmentIndex: number,
    flight: FlightDocument,
  ): Promise<void> {
    if (doc.segments.length < 2) return;
    const otherIndex = segmentIndex === 0 ? 1 : 0;
    const other = await this.flights.findById(doc.segments[otherIndex].flight);
    if (!other) return;
    const inOrder =
      segmentIndex === 0
        ? flight.arrivalUtc.getTime() < other.departureUtc.getTime()
        : other.arrivalUtc.getTime() < flight.departureUtc.getTime();
    if (!inOrder) {
      throw fieldError(
        'flightId',
        segmentIndex === 0
          ? 'The new outbound must land before your return flight leaves'
          : 'The new return must leave after your outbound flight lands',
      );
    }
  }

  /** Prices the booking with the new flight's current cabin terms (FLT-05). */
  private priced(
    doc: FlightBookingDocument,
    segmentIndex: number,
    fromFlight: FlightDocument,
    flight: FlightDocument,
    airline: AirlineDocument,
  ): PreparedChange {
    const current = doc.segments[segmentIndex];
    const cabin = flight.cabins.find(
      (c) => c.cabinClass === current.cabinClass,
    );
    const segment: ChangedSegment = {
      flight: flight._id,
      airline: airline._id,
      cabinClass: current.cabinClass,
      farePerSeat: cabin?.price ?? 0,
      freeBags: cabin?.freeBags ?? 0,
      maxBagWeightKg: cabin?.maxBagWeightKg ?? 0,
      extraBagPrice: airline.baggagePolicy?.extraBagPrice ?? 0,
    };
    const segments = doc.segments.map((s, i) =>
      i === segmentIndex ? segment : s,
    );
    const price = priceBooking(segments, doc.passengers);
    const currentSegmentTotal = doc.price.perSegment[segmentIndex];
    const newSegmentTotal = price.perSegment[segmentIndex];
    return {
      booking: doc,
      segmentIndex,
      fromFlight,
      flight,
      airline,
      segment,
      price,
      currentSegmentTotal,
      newSegmentTotal,
      difference: roundMoney(newSegmentTotal - currentSegmentTotal),
    };
  }

  /** Holds the new seats of a dearer change and stores it, unpaid. */
  private async holdDearer(
    prepared: PreparedChange,
    now: Date,
  ): Promise<FlightBookingChangeDocument> {
    const doc = prepared.booking;
    try {
      return await this.connection.transaction(async (session) => {
        const held = await this.holdSeats(prepared, now, session);
        if (held.difference <= 0) throw priceChanged();
        const [created] = await this.changes.create(
          [
            {
              booking: doc._id,
              user: doc.user,
              segmentIndex: prepared.segmentIndex,
              fromFlight: prepared.fromFlight._id,
              segment: held.segment,
              seats: doc.seats,
              previousTotal: doc.price.total,
              newTotal: held.price.total,
              difference: held.difference,
              currency: doc.currency,
              status: BookingStatus.PENDING_PAYMENT,
              holdExpiresAt: holdExpiresAt(now),
            },
          ],
          { session },
        );
        return created;
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw changePending();
      throw error;
    }
  }

  /**
   * A same-fare or cheaper change, in one transaction: the new seats are
   * held then booked, the old ones returned, the booking rewritten and the
   * change recorded (with the refund parts reserved on the ledger).
   */
  private async applyNow(
    prepared: PreparedChange,
    now: Date,
  ): Promise<{
    booking: FlightBookingDocument;
    change: FlightBookingChangeDocument;
  }> {
    const doc = prepared.booking;
    return this.connection.transaction(async (session) => {
      if (
        await this.changes
          .exists({ booking: doc._id, status: BookingStatus.PENDING_PAYMENT })
          .session(session)
      ) {
        throw changePending();
      }
      const held = await this.holdSeats(prepared, now, session);
      if (held.difference > 0) throw priceChanged();
      await this.bookSeats(held.segment, doc.seats, session);
      await this.returnSeats(
        doc.segments[prepared.segmentIndex],
        doc.seats,
        session,
      );

      let ledger = ledgerOf(doc);
      let parts: RefundPart[] = [];
      if (held.difference < 0) {
        ({ parts, ledger } = allocateRefund(ledger, -held.difference));
      }
      const booking = await this.rewriteBooking(
        doc,
        prepared.segmentIndex,
        prepared.fromFlight._id,
        held.segment,
        held.price,
        ledger,
        session,
      );
      // FLT-28: seats picked on the old flight do not carry over.
      await this.seatAssignments.releaseSegment(
        doc._id,
        prepared.segmentIndex,
        session,
      );
      const [change] = await this.changes.create(
        [
          {
            booking: doc._id,
            user: doc.user,
            segmentIndex: prepared.segmentIndex,
            fromFlight: prepared.fromFlight._id,
            segment: held.segment,
            seats: doc.seats,
            previousTotal: doc.price.total,
            newTotal: held.price.total,
            difference: held.difference,
            currency: doc.currency,
            status: BookingStatus.CONFIRMED,
            confirmedAt: now,
            ...(parts.length > 0
              ? {
                  refunds: parts.map((p) => ({
                    ...p,
                    status: 'PENDING' as const,
                  })),
                }
              : {}),
          },
        ],
        { session },
      );
      return { booking, change };
    });
  }

  private async confirmOnce(
    id: Types.ObjectId,
    paid: VerifiedFlightPayment,
    now: Date,
  ): Promise<ChangeConfirmAttempt> {
    return this.connection.transaction(async (session) => {
      const change = await this.changes.findById(id).session(session);
      if (!change) return { outcome: 'rejected', reason: 'NOT_FOUND' };
      if (change.status !== BookingStatus.PENDING_PAYMENT) {
        const samePayment =
          change.payment?.paymentIntentId === paid.paymentIntentId &&
          change.payment?.status === 'SUCCEEDED';
        if (!samePayment) return { outcome: 'rejected', reason: 'NOT_PENDING' };
        return {
          outcome:
            change.status === BookingStatus.CONFIRMED
              ? 'already_confirmed'
              : 'already_processed',
        };
      }
      const paidAt = paid.paidAt ?? now;
      if (
        !change.holdExpiresAt ||
        change.holdExpiresAt.getTime() <= paidAt.getTime()
      ) {
        return { outcome: 'rejected', reason: 'HOLD_EXPIRED' };
      }
      if (
        roundMoney(paid.amount) !== change.difference ||
        paid.currency.toUpperCase() !== change.currency.toUpperCase()
      ) {
        return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH' };
      }
      const doc = await this.bookings.findById(change.booking).session(session);
      if (
        !doc ||
        doc.status !== BookingStatus.CONFIRMED ||
        doc.segments[change.segmentIndex]?.flight.toString() !==
          change.fromFlight.toString()
      ) {
        return { outcome: 'rejected', reason: 'NOT_PENDING' };
      }
      const flight = await this.flights
        .findById(change.segment.flight)
        .session(session);
      if (
        !flight ||
        effectiveStatus(flight, now) !== FlightStatus.SCHEDULED ||
        flight.departureUtc.getTime() <= now.getTime()
      ) {
        return { outcome: 'rejected', reason: 'FLIGHT_NOT_BOOKABLE' };
      }

      await this.bookSeats(change.segment, change.seats, session);
      await this.returnSeats(
        doc.segments[change.segmentIndex],
        doc.seats,
        session,
      );
      const segments = doc.segments.map((s, i) =>
        i === change.segmentIndex ? change.segment : s,
      );
      const price = priceBooking(segments, doc.passengers);
      const ledger: LedgerEntry[] = [
        ...ledgerOf(doc),
        {
          paymentIntentId: paid.paymentIntentId,
          amount: change.difference,
          refunded: 0,
        },
      ];
      const booking = await this.rewriteBooking(
        doc,
        change.segmentIndex,
        change.fromFlight,
        change.segment,
        price,
        ledger,
        session,
      );
      // FLT-28: seats picked on the old flight do not carry over.
      await this.seatAssignments.releaseSegment(
        doc._id,
        change.segmentIndex,
        session,
      );
      const confirmed = await this.changes.findOneAndUpdate(
        { _id: id, status: BookingStatus.PENDING_PAYMENT },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            confirmedAt: now,
            newTotal: price.total,
            payment: {
              paymentIntentId: paid.paymentIntentId,
              status: 'SUCCEEDED',
            },
          },
        },
        { returnDocument: 'after', session },
      );
      if (!confirmed) return { outcome: 'rejected', reason: 'NOT_PENDING' };
      return { outcome: 'confirmed', change: confirmed, booking };
    });
  }

  /**
   * Holds the seats on the new flight and re-prices with the cabin terms at
   * that moment (FLT-05). 409 SEATS_UNAVAILABLE when they are gone.
   */
  private async holdSeats(
    prepared: PreparedChange,
    now: Date,
    session: ClientSession,
  ): Promise<{
    segment: ChangedSegment;
    price: BookingPriceBreakdown;
    difference: number;
  }> {
    const held = await this.seats.hold(
      prepared.flight._id,
      prepared.segment.cabinClass,
      prepared.booking.seats,
      session,
      now,
    );
    if (!held) throw seatsUnavailable(prepared.flight.flightNumber);
    const repriced = this.priced(
      prepared.booking,
      prepared.segmentIndex,
      prepared.fromFlight,
      held,
      prepared.airline,
    );
    return {
      segment: repriced.segment,
      price: repriced.price,
      difference: repriced.difference,
    };
  }

  private async bookSeats(
    segment: ChangedSegment,
    seats: number,
    session: ClientSession,
  ): Promise<void> {
    const moved = await this.seats.confirm(
      segment.flight,
      segment.cabinClass,
      seats,
      session,
    );
    if (!moved) {
      throw new InternalServerErrorException(
        'Seat inventory is inconsistent for this change',
      );
    }
  }

  private async returnSeats(
    segment: BookedSegment,
    seats: number,
    session: ClientSession,
  ): Promise<void> {
    await this.seats.returnBooked(
      segment.flight,
      segment.cabinClass,
      seats,
      session,
    );
  }

  /**
   * Rewrites the booking for the new segment. Conditional on the booking
   * still being Confirmed on the old flight, so two changes cannot both apply.
   */
  private async rewriteBooking(
    doc: FlightBookingDocument,
    segmentIndex: number,
    fromFlight: Types.ObjectId,
    segment: ChangedSegment,
    price: BookingPriceBreakdown,
    ledger: LedgerEntry[],
    session: ClientSession,
  ): Promise<FlightBookingDocument> {
    const plain = doc.toObject();
    const updated = await this.bookings.findOneAndUpdate(
      {
        _id: doc._id,
        status: BookingStatus.CONFIRMED,
        [`segments.${segmentIndex}.flight`]: fromFlight,
      },
      {
        $set: {
          [`segments.${segmentIndex}`]: segment,
          passengers: plain.passengers.map((p, i) => ({
            ...p,
            fare: price.passengers[i].fare,
            baggageFee: price.passengers[i].baggageFee,
          })),
          'price.fares': price.fares,
          'price.baggage': price.baggage,
          'price.total': price.total,
          'price.perSegment': price.perSegment,
          payments: ledger,
        },
      },
      { returnDocument: 'after', session },
    );
    if (!updated) {
      throw notChangeable('This booking changed meanwhile. Please try again.');
    }
    return updated;
  }

  /** Refunds a cheaper change's difference, one Stripe refund per payment. */
  private async refundDifference(
    change: FlightBookingChangeDocument,
  ): Promise<void> {
    const parts = change.refunds ?? [];
    if (parts.length === 0) return;
    const refunds = this.shared.refunds();
    if (!refunds?.refundPart) {
      this.logger.warn(
        `No refund service yet: the refund of flight change ${change.id} stays Pending`,
      );
      return;
    }
    for (const part of parts) {
      let set: Record<string, unknown>;
      try {
        const result = await refunds.refundPart({
          kind: 'fare_difference',
          bookingType: 'flight-change',
          bookingId: change.id,
          userId: change.user.toString(),
          paymentIntentId: part.paymentIntentId,
          amount: part.amount,
          currency: change.currency,
          idempotencyKey: `flight-change-refund-${change.id}-${part.paymentIntentId}`,
        });
        set = {
          'refunds.$.refundId': result.refundId,
          'refunds.$.status': result.status,
          ...(result.failureReason
            ? { 'refunds.$.failureReason': result.failureReason }
            : {}),
        };
      } catch (error) {
        const reason = refundFailureReason(error);
        this.logger.error(
          `Refund of flight change ${change.id} failed (${reason}); marked Failed`,
        );
        set = {
          'refunds.$.status': 'FAILED',
          'refunds.$.failureReason': reason,
        };
      }
      await this.changes.updateOne(
        {
          _id: change._id,
          refunds: {
            $elemMatch: {
              paymentIntentId: part.paymentIntentId,
              status: { $nin: FINAL_REFUND_STATUSES },
            },
          },
        },
        { $set: set },
      );
    }
  }

  private async notifyChanged(booking: FlightBookingDocument): Promise<void> {
    const view = await this.views.bookingView(booking);
    const flights = view.segments
      .map(
        (s) =>
          `${s.flightNumber} ${s.departure.airport.iataCode}-${s.arrival.airport.iataCode} on ${s.departure.localDate} at ${s.departure.localTime} (local time)`,
      )
      .join('; ');
    await this.shared.notify(
      booking.user.toString(),
      'FLIGHT_BOOKING_CHANGED',
      `Your flight booking ${view.reference ?? ''} is changed: ${flights}. Total ${view.price.total} ${view.currency}.`,
    );
  }

  private async view(
    prepared: PreparedChange,
    extra: Omit<
      FlightChangeView,
      | 'action'
      | 'segmentIndex'
      | 'newFlight'
      | 'currentSegmentTotal'
      | 'newSegmentTotal'
      | 'difference'
      | 'newTotal'
      | 'currency'
    >,
  ): Promise<FlightChangeView> {
    const airports = await this.views.airportsFor([
      prepared.flight.departureAirport,
      prepared.flight.arrivalAirport,
    ]);
    const difference = prepared.difference;
    return {
      action: difference > 0 ? 'pay' : difference < 0 ? 'refund' : 'none',
      segmentIndex: prepared.segmentIndex,
      newFlight: this.views.segmentView(
        prepared.flight,
        prepared.airline,
        prepared.segment.cabinClass,
        airports,
      ),
      currentSegmentTotal: prepared.currentSegmentTotal,
      newSegmentTotal: roundMoney(prepared.currentSegmentTotal + difference),
      difference,
      newTotal: roundMoney(prepared.booking.price.total + difference),
      currency: prepared.booking.currency,
      ...extra,
    };
  }

  private async findOwned(
    changeId: string,
    userId: string,
  ): Promise<FlightBookingChangeDocument> {
    const change = Types.ObjectId.isValid(changeId)
      ? await this.changes.findById(changeId)
      : null;
    if (!change || change.user.toString() !== userId) {
      throw new NotFoundException('Flight change not found');
    }
    return change;
  }
}

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Flight change not found');
  }
  return new Types.ObjectId(id);
}

function notChangeable(message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code: 'NOT_CHANGEABLE',
  });
}

function changePending(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message:
      'This booking already has a change waiting for payment. Pay it or let it expire first.',
    code: 'CHANGE_PENDING',
  });
}

function priceChanged(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message:
      'The fare changed while you were deciding. Preview the change again.',
    code: 'PRICE_CHANGED',
  });
}

function notPayable(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'This flight change is not waiting for payment.',
    code: 'NOT_PAYABLE',
  });
}

function seatsUnavailable(flightNumber: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `Not enough seats left on flight ${flightNumber} in this cabin. Choose another flight.`,
    code: 'SEATS_UNAVAILABLE',
  });
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
