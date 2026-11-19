import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { NOTIFICATION_SERVICE } from '../notifications/notification.service.interface';
import type { NotificationService } from '../notifications/notification.service.interface';
import { BookingPaymentGateway } from './booking-payment-gateway';
import type { RefundBasisView } from './booking-payment-gateway';
import { toMinorUnits } from './money';
import type {
  BookingType,
  RefundPreview,
  RefundResult,
  RefundService,
  RefundStatus,
} from './refund.service.interface';
import { Refund, RefundDocument } from './schemas/refund.schema';
import { STRIPE_CLIENT } from './stripe.provider';

export interface RefundView {
  refundId: string;
  bookingType: BookingType;
  bookingId: string;
  amount: number;
  percentage?: number;
  currency: string;
  status: RefundStatus;
  failureReason?: string;
}

/** Stripe refund status -> ours. `pending` and `requires_action` stay Pending. */
export function toRefundStatus(stripeStatus: string | null): RefundStatus {
  if (stripeStatus === 'succeeded') return 'REFUNDED';
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') return 'FAILED';
  return 'PENDING';
}

/**
 * PAY-03: refunds through the Stripe Refunds API. The tier rule itself lives
 * in `refundPercentFor` (flights/airline-policies) and is applied by the
 * flight and hotel modules when a booking is cancelled; this service previews
 * that result and pays out the amount fixed at cancellation.
 */
@Injectable()
export class RefundsService implements RefundService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectModel(Refund.name)
    private readonly refunds: Model<RefundDocument>,
    private readonly gateway: BookingPaymentGateway,
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
  ) {}

  /** What cancelling now would refund (for the cancel dialogs). */
  async preview(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundPreview> {
    const quote = await this.gateway.refundQuote(bookingType, bookingId);
    if (!quote) {
      throw new NotFoundException(
        'Booking not found or it can no longer be cancelled',
      );
    }
    return quote;
  }

  /**
   * Pays the refund fixed at cancellation. Safe to call twice: the Stripe
   * idempotency key and the unique {bookingType, bookingId} record mean one
   * booking is never refunded twice.
   */
  async issue(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundResult> {
    const basis = await this.gateway.refundBasis(bookingType, bookingId);
    if (!basis) {
      throw new NotFoundException('No refund is due for this booking');
    }
    if (basis.amount <= 0) {
      throw new ConflictException({
        message: 'The refund amount is zero, nothing to pay back',
        code: 'NOTHING_TO_REFUND',
      });
    }
    // A refund that already went out is read back, never created twice.
    const stripeRefund = basis.stripeRefundId
      ? await this.stripe.refunds.retrieve(basis.stripeRefundId)
      : await this.stripe.refunds.create(
          {
            payment_intent: basis.paymentIntentId,
            amount: toMinorUnits(basis.amount),
            metadata: { bookingType, bookingId, userId: basis.userId },
          },
          { idempotencyKey: basis.idempotencyKey },
        );
    const doc = await this.save(bookingType, bookingId, basis, stripeRefund);
    await this.notifyOnce(doc);
    return toResult(doc);
  }

  /** GET /refunds/:id: owner only; accepts the Stripe refund id or our id. */
  async get(userId: string, id: string): Promise<RefundView> {
    const doc = Types.ObjectId.isValid(id)
      ? await this.refunds.findById(id)
      : await this.refunds.findOne({ stripeRefundId: id });
    if (!doc || doc.userId.toString() !== userId) {
      throw new NotFoundException('Refund not found');
    }
    return toView(doc);
  }

  /**
   * Stripe webhook (`refund.updated`, `refund.failed`): Pending -> Refunded or
   * Failed. Only a Pending record moves, so a replayed or out-of-order event
   * never changes a final outcome and never notifies twice.
   */
  async onStripeRefund(refund: Stripe.Refund): Promise<void> {
    const status = toRefundStatus(refund.status);
    if (status === 'PENDING') return;
    const doc = await this.refunds.findOneAndUpdate(
      { stripeRefundId: refund.id, status: 'PENDING' },
      {
        $set: {
          status,
          ...(status === 'FAILED'
            ? { failureReason: refund.failure_reason ?? 'unknown' }
            : {}),
        },
      },
      { new: true },
    );
    if (!doc) {
      if (await this.refunds.exists({ stripeRefundId: refund.id })) return;
      // Our record is written right after Stripe answers `issue`; if the event
      // beat it, fail so the webhook claim is released and Stripe retries.
      throw new Error(`Refund ${refund.id} is not recorded yet`);
    }
    await this.gateway.recordRefund(
      doc.bookingType,
      doc.bookingId.toString(),
      toResult(doc),
    );
    await this.notifyOnce(doc);
  }

  private async save(
    bookingType: BookingType,
    bookingId: string,
    basis: RefundBasisView,
    stripeRefund: Stripe.Refund,
  ): Promise<RefundDocument> {
    const filter = {
      bookingType,
      bookingId: new Types.ObjectId(bookingId),
    };
    const status = toRefundStatus(stripeRefund.status);
    let doc: RefundDocument | null;
    try {
      doc = await this.refunds.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            userId: new Types.ObjectId(basis.userId),
            stripePaymentIntentId: basis.paymentIntentId,
            stripeRefundId: stripeRefund.id,
            amount: basis.amount,
            percentage: basis.percentage,
            currency: basis.currency.toUpperCase(),
            status,
            ...(status === 'FAILED'
              ? { failureReason: stripeRefund.failure_reason ?? 'unknown' }
              : {}),
          },
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      doc = await this.refunds.findOne(filter);
    }
    if (!doc) throw new InternalServerErrorException();
    return doc;
  }

  /** Tells the user about a final outcome, exactly once per refund. */
  private async notifyOnce(doc: RefundDocument): Promise<void> {
    if (doc.status === 'PENDING') return;
    const claimed = await this.refunds.findOneAndUpdate(
      { _id: doc._id, notifiedAt: null },
      { $set: { notifiedAt: new Date() } },
    );
    if (!claimed) return;
    const refunded = doc.status === 'REFUNDED';
    try {
      await this.notifications.notify(
        doc.userId.toString(),
        refunded ? 'REFUND_ISSUED' : 'REFUND_FAILED',
        refunded
          ? `Your refund of ${doc.amount} ${doc.currency} has been issued.`
          : `Your refund of ${doc.amount} ${doc.currency} could not be completed. Please contact support.`,
      );
    } catch (error) {
      this.logger.error(
        `Could not notify user ${doc.userId.toString()} about refund ${doc.stripeRefundId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function toResult(doc: RefundDocument): RefundResult {
  return {
    refundId: doc.stripeRefundId,
    amount: doc.amount,
    status: doc.status,
    currency: doc.currency,
  };
}

function toView(doc: RefundDocument): RefundView {
  return {
    refundId: doc.stripeRefundId,
    bookingType: doc.bookingType,
    bookingId: doc.bookingId.toString(),
    amount: doc.amount,
    percentage: doc.percentage,
    currency: doc.currency,
    status: doc.status,
    ...(doc.failureReason ? { failureReason: doc.failureReason } : {}),
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
