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
   * Asks the payments module to send the money back. If it is not connected
   * yet or Stripe fails, the refund stays PENDING (recorded above) so it can
   * be retried; the cancellation itself stands.
   */
  private async issueRefund(doc: HotelReservationDocument): Promise<void> {
    const refunds = this.shared.refunds();
    if (!refunds) return;
    try {
      const result = await refunds.issue('hotel', doc.id);
      doc.refund = {
        ...doc.refund,
        stripeRefundId: result.refundId,
        amount: result.amount,
        currency: result.currency,
        status: result.status,
      };
      await this.reservations.updateOne(
        { _id: doc._id },
        {
          $set: {
            'refund.stripeRefundId': result.refundId,
            'refund.amount': result.amount,
            'refund.currency': result.currency,
            'refund.status': result.status,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Refund for hotel reservation ${doc.id} could not be issued yet`,
        error instanceof Error ? error.stack : String(error),
      );
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
