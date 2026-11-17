import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { newBookingReference } from './booking-reference';
import { ReservationStatus, assertCanTransition } from './reservation-status';
import { HotelReservationView, toReservationView } from './reservation-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import { RoomNight, RoomNightDocument } from './schemas/room-night.schema';
import { SharedServices } from './shared-services';
import { formatDate } from './stay-rules';

/** What the payments module needs to start a PaymentIntent (PAY-01). */
export interface PayableReservation {
  reservationId: string;
  userId: string;
  amount: number;
  currency: string;
  holdExpiresAt: Date;
  description: string;
  /** Set when a PaymentIntent was already created for this hold (retry). */
  paymentIntentId: string | null;
}

/** The Stripe facts the webhook verified (PAY-01). */
export interface VerifiedPayment {
  paymentIntentId: string;
  amount: number;
  currency: string;
}

export type ConfirmResult =
  | {
      outcome: 'confirmed' | 'already_confirmed';
      reservation: HotelReservationView;
    }
  | {
      /** The payment must be refunded by the caller: nothing was confirmed. */
      outcome: 'rejected';
      reason: 'NOT_FOUND' | 'NOT_PENDING' | 'HOLD_EXPIRED' | 'AMOUNT_MISMATCH';
    };

/** One transaction's answer; `userId` is for the notification after commit. */
type ConfirmAttempt =
  | { outcome: 'confirmed'; reservation: HotelReservationView; userId: string }
  | { outcome: 'already_confirmed'; reservation: HotelReservationView }
  | Extract<ConfirmResult, { outcome: 'rejected' }>;

/** Reference collisions are astronomically rare; retry a few times anyway. */
const REFERENCE_ATTEMPTS = 3;

function isDuplicateReference(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyPattern } = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  return (
    code === 11000 && keyPattern !== undefined && 'reference' in keyPattern
  );
}

/**
 * The hotel side of payments (PAY-01, HTL-17). Called by the payments module
 * (Ziad): `forPayment` before creating a PaymentIntent, `attachPaymentIntent`
 * once it exists, and `confirmPaid` from the verified Stripe webhook. Only a
 * verified payment confirms a reservation.
 */
@Injectable()
export class HotelReservationPayments {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNightDocument>,
    private readonly shared: SharedServices,
  ) {}

  /**
   * The amount to charge for the user's own live hold. 404 when it is not
   * theirs; 409 when it is no longer payable (expired, paid, cancelled).
   */
  async forPayment(
    reservationId: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<PayableReservation> {
    const doc = await this.findOwned(reservationId, userId);
    if (doc.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new ConflictException({
        message: 'This reservation is not waiting for payment',
        code: 'NOT_PENDING',
      });
    }
    if (!doc.holdExpiresAt || doc.holdExpiresAt.getTime() <= now.getTime()) {
      throw new ConflictException({
        message: 'The 10-minute hold has expired; please book again',
        code: 'HOLD_EXPIRED',
      });
    }
    return {
      reservationId: doc.id,
      userId,
      amount: doc.totalPrice,
      currency: doc.currency,
      holdExpiresAt: doc.holdExpiresAt,
      description: `${doc.hotelName}, ${doc.rooms.length} room(s), ${formatDate(doc.checkIn)} to ${formatDate(doc.checkOut)}`,
      paymentIntentId: doc.payment?.stripePaymentIntentId ?? null,
    };
  }

  /** Remembers the PaymentIntent of a live hold (no card data, PAY-01). */
  async attachPaymentIntent(
    reservationId: string,
    paymentIntentId: string,
    status: string,
  ): Promise<boolean> {
    const result = await this.reservations.updateOne(
      {
        _id: new Types.ObjectId(reservationId),
        status: ReservationStatus.PENDING_PAYMENT,
      },
      {
        $set: {
          'payment.stripePaymentIntentId': paymentIntentId,
          'payment.status': status,
        },
      },
    );
    return result.matchedCount === 1;
  }

  /** Records a failed attempt; the user may retry until the hold expires. */
  async recordPaymentFailure(
    reservationId: string,
    paymentIntentId: string,
  ): Promise<void> {
    await this.reservations.updateOne(
      {
        _id: new Types.ObjectId(reservationId),
        status: ReservationStatus.PENDING_PAYMENT,
        'payment.stripePaymentIntentId': paymentIntentId,
      },
      { $set: { 'payment.status': 'failed' } },
    );
  }

  /**
   * HTL-17: called only after the webhook verified that the PaymentIntent
   * succeeded. Confirms all rooms at once, assigns the unique reference and
   * sends the in-app notification. Safe to call twice for the same payment
   * (Stripe retries webhooks). A `rejected` result means nothing changed and
   * the payment has to be refunded.
   */
  async confirmPaid(
    reservationId: string,
    payment: VerifiedPayment,
    now: Date = new Date(),
  ): Promise<ConfirmResult> {
    if (!Types.ObjectId.isValid(reservationId)) {
      return { outcome: 'rejected', reason: 'NOT_FOUND' };
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = await this.confirmOnce(reservationId, payment, now);
        if (result.outcome === 'confirmed') {
          const view = result.reservation;
          await this.shared.notify(
            result.userId,
            'HOTEL_BOOKING_CONFIRMED',
            `Your reservation ${view.reference} at ${view.hotel.name} is confirmed: ` +
              `${view.rooms.length} room(s), ${view.checkIn} to ${view.checkOut}, ` +
              `${view.guests.adults} adult(s) and ${view.guests.children} child(ren). ` +
              `Total paid: ${view.totalPrice} ${view.currency}.`,
          );
          return { outcome: 'confirmed', reservation: view };
        }
        return result;
      } catch (error) {
        if (isDuplicateReference(error) && attempt < REFERENCE_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
  }

  private async confirmOnce(
    reservationId: string,
    payment: VerifiedPayment,
    now: Date,
  ): Promise<ConfirmAttempt> {
    return this.connection.transaction(async (session) => {
      const doc = await this.reservations
        .findById(reservationId)
        .session(session);
      if (!doc) return { outcome: 'rejected', reason: 'NOT_FOUND' } as const;

      if (doc.status === ReservationStatus.CONFIRMED) {
        return doc.payment?.stripePaymentIntentId === payment.paymentIntentId
          ? ({
              outcome: 'already_confirmed',
              reservation: toReservationView(doc, now),
            } as const)
          : ({ outcome: 'rejected', reason: 'NOT_PENDING' } as const);
      }
      if (doc.status !== ReservationStatus.PENDING_PAYMENT) {
        return { outcome: 'rejected', reason: 'NOT_PENDING' } as const;
      }
      if (!doc.holdExpiresAt || doc.holdExpiresAt.getTime() <= now.getTime()) {
        return { outcome: 'rejected', reason: 'HOLD_EXPIRED' } as const;
      }
      if (
        Math.round(payment.amount * 100) !== Math.round(doc.totalPrice * 100) ||
        payment.currency.toUpperCase() !== doc.currency.toUpperCase()
      ) {
        return { outcome: 'rejected', reason: 'AMOUNT_MISMATCH' } as const;
      }

      // Every night of every room must still be ours; then they stop expiring.
      const expected = doc.rooms.length * doc.nights;
      const kept = await this.roomNights.updateMany(
        { reservation: doc._id },
        { $unset: { holdExpiresAt: 1 } },
        { session },
      );
      if (kept.matchedCount !== expected) {
        return { outcome: 'rejected', reason: 'HOLD_EXPIRED' } as const;
      }

      assertCanTransition(doc.status, ReservationStatus.CONFIRMED);
      doc.status = ReservationStatus.CONFIRMED;
      doc.reference = newBookingReference();
      doc.confirmedAt = now;
      doc.holdExpiresAt = undefined;
      doc.payment = {
        stripePaymentIntentId: payment.paymentIntentId,
        status: 'succeeded',
        amount: payment.amount,
        currency: payment.currency.toUpperCase(),
      };
      await doc.save({ session });
      return {
        outcome: 'confirmed',
        reservation: toReservationView(doc, now),
        userId: doc.user.toString(),
      } as const;
    });
  }

  private async findOwned(
    reservationId: string,
    userId: string,
  ): Promise<HotelReservationDocument> {
    const doc = Types.ObjectId.isValid(reservationId)
      ? await this.reservations.findById(reservationId)
      : null;
    if (!doc || doc.user.toString() !== userId) {
      throw new NotFoundException('Reservation not found');
    }
    return doc;
  }
}
