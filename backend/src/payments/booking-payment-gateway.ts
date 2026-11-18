import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlightBookingPayments } from '../flight-bookings/flight-booking-payments';
import { HotelReservationPayments } from '../hotel-bookings/hotel-reservation-payments';
import {
  HotelReservation,
  HotelReservationDocument,
} from '../hotel-bookings/schemas/hotel-reservation.schema';
import type { BookingType } from './refund.service.interface';

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
  /** Hotels: the stay dates (check-in/out times come from the hotels module). */
  stay?: { checkIn: Date; checkOut: Date };
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
    private readonly hotels: HotelReservationPayments,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
  ) {}

  /** Owner-only policies of a booking; 404 for anyone else's. */
  async policies(
    type: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<BookingPoliciesView> {
    if (type === 'flight') {
      const p = await this.flights.policiesFor(bookingId, userId);
      return {
        bookingType: 'flight',
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
    return {
      bookingType: 'hotel',
      cancellationTiers: doc.cancellationTiers.map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
      stay: { checkIn: doc.checkIn, checkOut: doc.checkOut },
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
    const result =
      type === 'flight'
        ? await this.flights.confirmPaid(bookingId, paid)
        : await this.hotels.confirmPaid(bookingId, paid);
    return result.outcome;
  }
}
