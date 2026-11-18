import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import {
  RefundQuote,
  assertCancellable,
  quoteRefund,
} from './cancellation-rules';
import { ReservationStatus, assertCanTransition } from './reservation-status';
import { HotelReservationView, toReservationView } from './reservation-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import { RoomNight, RoomNightDocument } from './schemas/room-night.schema';
import { SharedServices } from './shared-services';

/**
 * A short, safe reason for a failed refund: Stripe's error code when it has
 * one (e.g. `charge_already_refunded`), never a message, stack or secret.
 */
export function refundFailureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code)) {
      return `STRIPE_${code.toUpperCase()}`;
    }
  }
  return 'REFUND_ISSUE_FAILED';
}

export interface CancellationResult {
  reservation: HotelReservationView;
  refund: RefundQuote;
}

/**
 * HTL-21: a guest cancels their own Confirmed reservation as a whole before
 * the check-in date. The refund follows the hotel's tiers on the full total,
 * all rooms are released, and the refund itself is issued through the
 * payments module's RefundService (PAY-03).
 */
@Injectable()
export class HotelCancellationsService {
  private readonly logger = new Logger(HotelCancellationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNightDocument>,
    private readonly shared: SharedServices,
  ) {}

  /** What the guest would get back if they cancelled now. */
  async preview(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<RefundQuote> {
    const doc = await this.findOwned(id, user);
    assertCancellable(doc, now);
    return quoteRefund(doc, now);
  }

  async cancel(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<CancellationResult> {
    // One transaction: two cancellations at once cannot both pass the check.
    const { doc, quote } = await this.connection.transaction(
      async (session) => {
        const found = await this.reservations.findById(id).session(session);
        if (!found || found.user.toString() !== user.id) {
          throw new NotFoundException('Reservation not found');
        }
        assertCancellable(found, now);
        assertCanTransition(found.status, ReservationStatus.CANCELLED);

        const refund = quoteRefund(found, now);
        found.status = ReservationStatus.CANCELLED;
        found.cancelledAt = now;
        found.refund = {
          percentage: refund.refundPercent,
          amount: refund.refundAmount,
          currency: refund.currency,
          status: refund.refundAmount > 0 ? 'PENDING' : 'NONE',
        };
        await found.save({ session });
        // All rooms are free again for those dates.
        await this.roomNights.deleteMany(
          { reservation: found._id },
          { session },
        );
        return { doc: found, quote: refund };
      },
    );

    if (quote.refundAmount > 0) await this.issueRefund(doc);

    await this.shared.notify(
      user.id,
      'HOTEL_BOOKING_CANCELLED',
      `Your reservation ${doc.reference ?? ''} at ${doc.hotelName} ` +
        `(${quote.checkIn}) is cancelled. Refund: ${quote.refundAmount} ` +
        `${quote.currency} (${quote.refundPercent}% of ${quote.totalPrice}).`,
    );
    return { reservation: toReservationView(doc, now), refund: quote };
  }

  /**
   * Asks the payments module to send the money back (PAY-03). The
   * cancellation itself always stands and the rooms stay released:
   * - refund service not wired in this deployment: the refund stays PENDING
   *   (a deploy state, not a failure) and can be issued later;
   * - Stripe / the refund service throws: the refund becomes FAILED with a
   *   short reason code (never a stack or secret), visible on the details;
   * - otherwise the result is stored (REFUNDED, or PENDING/FAILED as Stripe
   *   reported it).
   */
  private async issueRefund(doc: HotelReservationDocument): Promise<void> {
    const refunds = this.shared.refunds();
    if (!refunds) {
      this.logger.warn(
        `No refund service yet: the refund of hotel reservation ${doc.id} stays Pending`,
      );
      return;
    }
    try {
      const result = await refunds.issue('hotel', doc.id);
      doc.refund = {
        ...doc.refund,
        stripeRefundId: result.refundId,
        amount: result.amount,
        currency: result.currency,
        status: result.status,
        failureReason: undefined,
      };
      await this.reservations.updateOne(
        { _id: doc._id, status: ReservationStatus.CANCELLED },
        {
          $set: {
            'refund.stripeRefundId': result.refundId,
            'refund.amount': result.amount,
            'refund.currency': result.currency,
            'refund.status': result.status,
          },
          $unset: { 'refund.failureReason': 1 },
        },
      );
    } catch (error) {
      const reason = refundFailureReason(error);
      this.logger.error(
        `Refund of hotel reservation ${doc.id} failed (${reason}); marked Failed`,
      );
      // Only a still-pending refund becomes Failed: never overwrite an
      // outcome a refund webhook may have recorded in the meantime.
      const marked = await this.reservations.updateOne(
        {
          _id: doc._id,
          status: ReservationStatus.CANCELLED,
          'refund.status': 'PENDING',
        },
        {
          $set: {
            'refund.status': 'FAILED',
            'refund.failureReason': reason,
          },
        },
      );
      if (marked.modifiedCount === 1) {
        doc.refund = { ...doc.refund, status: 'FAILED', failureReason: reason };
      }
    }
  }

  private async findOwned(
    id: string,
    user: AuthUser,
  ): Promise<HotelReservationDocument> {
    const doc = Types.ObjectId.isValid(id)
      ? await this.reservations.findById(id)
      : null;
    if (!doc || doc.user.toString() !== user.id) {
      throw new NotFoundException('Reservation not found');
    }
    return doc;
  }
}
