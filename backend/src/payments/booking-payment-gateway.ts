import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlightBookingChangesService } from '../flight-bookings/flight-booking-changes.service';
import { FlightBookingPayments } from '../flight-bookings/flight-booking-payments';
import { HotelInventoryRegistry } from '../hotel-bookings/hotel-inventory';
import { HotelReservationPayments } from '../hotel-bookings/hotel-reservation-payments';
import {
  HotelReservation,
  HotelReservationDocument,
} from '../hotel-bookings/schemas/hotel-reservation.schema';
import type {
  BookingType,
  RefundPreview,
  RefundResult,
} from './refund.service.interface';

/** What every booking type must tell us to start a PaymentIntent. */
export interface PayableBooking {
  bookingId: string;
  amount: number;
  currency: string;
  holdExpiresAt: Date;
  description: string;
  paymentIntentId: string | null;
}

export interface VerifiedPaid {
  paymentIntentId: string;
  amount: number;
  currency: string;
  /** When Stripe recorded the payment as succeeded (the webhook event time). */
  paidAt?: Date;
}

/** PAY-02: what the user reads before accepting. */
export interface BookingPoliciesView {
  bookingType: BookingType;
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  /** Flights: baggage rules. */
  baggage?: {
    baggagePolicy: { extraBagPrice: number; maxExtraBags: number } | null;
    freeBags: number[];
    maxBagWeightKg: number[];
  };
  /**
   * Hotels: this booking's stay dates, plus the hotel's standard check-in and
   * check-out times (HH:mm, set by its moderator, HTL-09).
   */
  stay?: {
    checkIn: Date;
    checkOut: Date;
    checkInTime?: string;
    checkOutTime?: string;
  };
}

/** PAY-03: what is needed to refund a cancelled booking, for either type. */
export interface RefundBasisView {
  bookingId: string;
  userId: string;
  paymentIntentId: string;
  amount: number;
  percentage: number;
  currency: string;
  /** PENDING, REFUNDED or FAILED, as stored on the booking. */
  status: string;
  /** The Stripe refund already created for this cancellation, if any. */
  stripeRefundId: string | null;
  /** Stable per booking; Stripe's `Idempotency-Key` when creating the refund. */
  idempotencyKey: string;
  failureReason: string | null;
}

export type ConfirmOutcome =
  'confirmed' | 'already_confirmed' | 'already_processed' | 'rejected';

/**
 * One place that hides the difference between flight bookings and hotel
 * reservations, so the payment logic is written once.
 */
@Injectable()
export class BookingPaymentGateway {
  constructor(
    private readonly flights: FlightBookingPayments,
    private readonly changes: FlightBookingChangesService,
    private readonly hotels: HotelReservationPayments,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    private readonly inventory: HotelInventoryRegistry,
  ) {}

  /** Owner-only policies of a booking; 404 for anyone else's. */
  async policies(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<BookingPoliciesView> {
    if (type === 'flight' || type === 'flight-change') {
      const p =
        type === 'flight'
          ? await this.flights.policiesFor(bookingId, userId)
          : await this.changes.policiesFor(bookingId, userId);
      return {
        bookingType: type,
        cancellationTiers: p.cancellationTiers,
        baggage: {
          baggagePolicy: p.baggagePolicy,
          freeBags: p.freeBags,
          maxBagWeightKg: p.maxBagWeightKg,
        },
      };
    }
    const doc = Types.ObjectId.isValid(bookingId)
      ? await this.reservations.findById(bookingId)
      : null;
    if (!doc || doc.user.toString() !== userId) {
      throw new NotFoundException('Reservation not found');
    }
    // The times belong to the hotel (its policies), not to this reservation.
    const hotel = await this.inventory.get()?.findHotel(doc.hotel.toString());
    if (!hotel) throw new NotFoundException('Hotel not found');
    return {
      bookingType: 'hotel',
      cancellationTiers: doc.cancellationTiers.map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
      stay: {
        checkIn: doc.checkIn,
        checkOut: doc.checkOut,
        ...(hotel.checkInTime ? { checkInTime: hotel.checkInTime } : {}),
        ...(hotel.checkOutTime ? { checkOutTime: hotel.checkOutTime } : {}),
      },
    };
  }

  /** Owner-only; 404 when not theirs, 409 when the hold is gone or paid. */
  async payable(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<PayableBooking> {
    if (type === 'flight') {
      return this.flights.forPayment(bookingId, userId);
    }
    if (type === 'flight-change') {
      return this.changes.forPayment(bookingId, userId);
    }
    const r = await this.hotels.forPayment(bookingId, userId);
    return {
      bookingId: r.reservationId,
      amount: r.amount,
      currency: r.currency,
      holdExpiresAt: r.holdExpiresAt,
      description: r.description,
      paymentIntentId: r.paymentIntentId,
    };
  }

  async attach(
    type: BookingType,
    bookingId: string,
    paymentIntentId: string,
    status: string,
  ): Promise<void> {
    if (type === 'flight') {
      await this.flights.attachPaymentIntent(bookingId, paymentIntentId);
    } else if (type === 'flight-change') {
      await this.changes.attachPaymentIntent(bookingId, paymentIntentId);
    } else {
      await this.hotels.attachPaymentIntent(bookingId, paymentIntentId, status);
    }
  }

  async recordFailure(
    type: BookingType,
    bookingId: string,
    paymentIntentId: string,
  ): Promise<void> {
    if (type === 'flight') {
      await this.flights.recordPaymentFailure(bookingId);
    } else if (type === 'flight-change') {
      await this.changes.recordPaymentFailure(bookingId);
    } else {
      await this.hotels.recordPaymentFailure(bookingId, paymentIntentId);
    }
  }

  /** Only called from the verified webhook (PAY-01). `rejected` => refund. */
  async confirm(
    type: BookingType,
    bookingId: string,
    paid: VerifiedPaid,
  ): Promise<ConfirmOutcome> {
    if (type === 'flight-change') {
      return (await this.changes.confirmPaid(bookingId, paid)).outcome;
    }
    const result =
      type === 'flight'
        ? await this.flights.confirmPaid(bookingId, paid)
        : await this.hotels.confirmPaid(bookingId, paid);
    return result.outcome;
  }

  /** PAY-03: what cancelling now would refund; `null` if it cannot be cancelled. */
  async refundQuote(
    type: BookingType,
    bookingId: string,
  ): Promise<RefundPreview | null> {
    if (type === 'flight-change') return null; // a change is not cancelled on its own
    const quote =
      type === 'flight'
        ? await this.flights.refundQuote(bookingId)
        : await this.hotels.refundQuote(bookingId);
    if (!quote) return null;
    return {
      refundPercent: quote.refundPercent,
      refundAmount: quote.refundAmount,
      currency: quote.currency,
    };
  }

  /** PAY-03: the amount fixed at cancellation and the PaymentIntent to refund. */
  async refundBasis(
    type: BookingType,
    bookingId: string,
  ): Promise<RefundBasisView | null> {
    if (type === 'flight') {
      const b = await this.flights.refundBasis(bookingId);
      return b;
    }
    if (type === 'flight-change') return null;
    const b = await this.hotels.refundBasis(bookingId);
    return b && { ...b, bookingId: b.reservationId };
  }

  /** PAY-03: stores the refund outcome on the booking. */
  async recordRefund(
    type: BookingType,
    bookingId: string,
    result: RefundResult,
  ): Promise<void> {
    if (type === 'flight') {
      await this.flights.recordRefundResult(bookingId, result);
    } else if (type === 'flight-change') {
      await this.changes.recordRefundResult(bookingId, result);
    } else {
      await this.hotels.recordRefundResult(bookingId, result);
    }
  }

  /**
   * PAY-02: whose accepted policies cover a payment. A flight change keeps
   * the policies the user accepted for the booking it changes (FLT-27).
   */
  async acceptanceTarget(
    type: BookingType,
    bookingId: string,
  ): Promise<{ type: BookingType; bookingId: string }> {
    if (type !== 'flight-change') return { type, bookingId };
    const booking = await this.changes.bookingOf(bookingId);
    return booking
      ? { type: 'flight', bookingId: booking }
      : { type, bookingId };
  }
}
