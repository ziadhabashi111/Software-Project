import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingPaymentGateway } from './booking-payment-gateway';
import type {
  PaymentService,
  PendingPaymentCancellation,
} from './payment.service.interface';
import { fromMinorUnits, toMinorUnits } from './money';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { BOOKING_TYPES } from './refund.service.interface';
import type { BookingType } from './refund.service.interface';
import { RefundsService, toRefundStatus } from './refunds.service';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import {
  ProcessedStripeEvent,
  ProcessedStripeEventDocument,
} from './schemas/processed-stripe-event.schema';
import { STRIPE_CLIENT } from './stripe.provider';

/** Stripe event types this service acts on; others are acknowledged and ignored. */
const HANDLED_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'refund.updated',
  'refund.failed',
]);

/** Final payment states: only succeeded -> refunded may leave one of them. */
const FINAL_STATES = ['succeeded', 'refunded'];

export interface PaymentView {
  paymentId: string;
  bookingType: BookingType;
  bookingId: string;
  amount: number;
  currency: string;
  status: string;
  /** Only returned when a payment is started or retried; the browser confirms with it. */
  clientSecret?: string;
  holdExpiresAt?: Date;
}

/** PaymentIntent states in which the same intent can still be paid. */
const PAYABLE_STATES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
]);

export { toMinorUnits };

/**
 * PAY-01: Stripe PaymentIntents. Card data goes from the browser to Stripe
 * only. A booking is confirmed solely by the verified webhook.
 */
@Injectable()
export class PaymentsService implements PaymentService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly config: ConfigService,
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    private readonly gateway: BookingPaymentGateway,
    private readonly policies: PolicyAcceptanceService,
    @InjectModel(ProcessedStripeEvent.name)
    private readonly processedEvents: Model<ProcessedStripeEventDocument>,
    private readonly refunds: RefundsService,
  ) {}

  /** POST /payments: starts (or reuses) the PaymentIntent of the user's own hold. */
  async start(
    userId: string,
    type: BookingType,
    bookingId: string,
  ): Promise<PaymentView> {
    // 404 for someone else's booking, 409 for an expired or paid hold.
    const payable = await this.gateway.payable(type, bookingId, userId);
    await this.policies.assertAccepted(type, bookingId, userId);

    let intent: Stripe.PaymentIntent | null = null;
    let createdNew = false;
    if (payable.paymentIntentId) {
      const existing = await this.stripe.paymentIntents.retrieve(
        payable.paymentIntentId,
      );
      if (existing.status === 'succeeded' || existing.status === 'processing') {
        throw new ConflictException({
          message: 'This booking is already paid or being processed',
          code: 'ALREADY_PAID',
        });
      }
      if (PAYABLE_STATES.has(existing.status)) intent = existing;
    }

    if (!intent) {
      const previous = await this.payments.findOne({
        bookingType: type,
        bookingId: new Types.ObjectId(bookingId),
      });
      const attempt = (previous?.attempts ?? 0) + 1;
      intent = await this.stripe.paymentIntents.create(
        {
          amount: toMinorUnits(payable.amount),
          currency: payable.currency.toLowerCase(),
          description: payable.description,
          automatic_payment_methods: { enabled: true },
          metadata: { bookingType: type, bookingId, userId },
        },
        { idempotencyKey: `pi-${type}-${bookingId}-${attempt}` },
      );
      createdNew = true;
      await this.gateway.attach(type, bookingId, intent.id, intent.status);
    }

    const created = intent;
    const filter = {
      bookingType: type,
      bookingId: new Types.ObjectId(bookingId),
    };
    let payment: PaymentDocument | null;
    try {
      payment = await this.payments.findOneAndUpdate(
        filter,
        {
          $set: {
            userId: new Types.ObjectId(userId),
            stripePaymentIntentId: created.id,
            amount: payable.amount,
            currency: payable.currency.toUpperCase(),
            status: created.status,
          },
          ...(createdNew ? { $inc: { attempts: 1 } } : {}),
        },
        { upsert: true, new: true },
      );
    } catch (error) {
      // Two first requests for the same booking raced the unique
      // {bookingType, bookingId} upsert. Both got the same PaymentIntent
      // (same idempotency key), so answer with the winner's record.
      if (!isDuplicateKey(error)) throw error;
      payment = await this.payments.findOne(filter);
    }
    if (!payment) throw new InternalServerErrorException();
    return {
      ...toView(payment),
      status: created.status,
      clientSecret: created.client_secret ?? undefined,
      holdExpiresAt: payable.holdExpiresAt,
    };
  }

  /** POST /payments/:id/retry: pay again (same hold) after a failed attempt. */
  async retry(userId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.findOwned(userId, paymentId);
    return this.start(
      userId,
      payment.bookingType,
      payment.bookingId.toString(),
    );
  }

  /** GET /payments/:id: owner-only; 404 for anyone else's payment. */
  async get(userId: string, paymentId: string): Promise<PaymentView> {
    return toView(await this.findOwned(userId, paymentId));
  }

  /**
   * Called when a Pending Payment hold expires or is released: the user can no
   * longer pay for it. Never throws (the expiry job must not fail on Stripe).
   */
  async cancelPendingPayment(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PendingPaymentCancellation> {
    let intentId: string | undefined;
    try {
      if (!Types.ObjectId.isValid(bookingId)) return 'none';
      const payment = await this.payments.findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
      });
      intentId = payment?.stripePaymentIntentId;
      if (!payment || !intentId) return 'none';
      if (payment.status === 'succeeded') return 'not_cancellable';
      if (['canceled', 'refunded'].includes(payment.status)) {
        return 'cancelled';
      }
      await this.stripe.paymentIntents.cancel(intentId);
      await this.payments.updateOne(
        { _id: payment._id, status: { $nin: FINAL_STATES } },
        { $set: { status: 'canceled' } },
      );
      return 'cancelled';
    } catch (error) {
      if (intentId && isStripeUnexpectedState(error)) {
        // Expected race: the intent already succeeded, is processing or was
        // cancelled before the hold expired. If it was paid, the webhook
        // confirms the booking or refunds the payment.
        this.logger.warn(
          `PaymentIntent of ${bookingType} ${bookingId} can no longer be cancelled`,
        );
        return this.stateOf(intentId);
      }
      this.logger.error(
        `Could not cancel the PaymentIntent of ${bookingType} ${bookingId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'error';
    }
  }

  /** After Stripe refused to cancel: already cancelled, or paid / processing. */
  private async stateOf(intentId: string): Promise<PendingPaymentCancellation> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(intentId);
      return intent.status === 'canceled' ? 'cancelled' : 'not_cancellable';
    } catch {
      return 'error';
    }
  }

  /**
   * POST /payments/webhook: the only place a booking becomes Confirmed.
   * The signature is checked against the RAW body. Stripe retries are safe:
   * a fully handled event id is skipped (ProcessedStripeEvent), `confirmPaid` is
   * idempotent, and a payment already marked refunded is never refunded again.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    // A blank STRIPE_WEBHOOK_SECRET is a missing-configuration state, not an
    // unexpected crash: answer 503 (payments unavailable) so the response is
    // honest and Stripe does not retry it as a transient 5xx fault.
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('Payments are not configured');
    }
    if (!rawBody || !signature) {
      throw new BadRequestException('Missing Stripe signature or body');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }

    if (!HANDLED_EVENTS.has(event.type)) {
      return { received: true }; // other events are not needed for PAY-01/PAY-03
    }
    // An event already handled to the end is acknowledged and skipped. It is
    // recorded only AFTER its handler succeeded, so a crash or error half-way
    // leaves nothing behind and Stripe's retry processes it. Two concurrent
    // deliveries may both run; every handler is idempotent (`confirmPaid`
    // answers `already_confirmed`, refunds reuse one idempotency key, status
    // updates are conditional).
    if (await this.processedEvents.exists({ eventId: event.id })) {
      return { received: true };
    }
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onSucceeded(event.data.object, event.created);
        break;
      case 'payment_intent.payment_failed':
        await this.onFailed(event.data.object);
        break;
      case 'payment_intent.canceled':
        await this.setStatus(event.data.object, 'canceled');
        break;
      case 'refund.updated':
      case 'refund.failed':
        await this.refunds.onStripeRefund(event.data.object);
        await this.onRefundSettled(event.data.object);
        break;
      default:
        break;
    }
    await this.markProcessed(event);
    return { received: true };
  }

  /** Remembers a fully handled event; a concurrent duplicate may beat us. */
  private async markProcessed(event: Stripe.Event): Promise<void> {
    try {
      await this.processedEvents.create({
        eventId: event.id,
        type: event.type,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  /**
   * `createdSeconds` is when Stripe generated the event, i.e. when the
   * payment succeeded: a payment made inside the hold counts as on time even
   * if its webhook arrives after the hold ended (FLT-22, HTL-18).
   */
  private async onSucceeded(
    intent: Stripe.PaymentIntent,
    createdSeconds: number | undefined,
  ): Promise<void> {
    const ref = readReference(intent);
    if (!ref) return;
    const outcome = await this.gateway.confirm(ref.type, ref.bookingId, {
      paymentIntentId: intent.id,
      amount: fromMinorUnits(intent.amount_received),
      currency: intent.currency.toUpperCase(),
      ...(createdSeconds ? { paidAt: new Date(createdSeconds * 1000) } : {}),
    });
    // Only `rejected` refunds. `already_confirmed` / `already_processed`
    // (replay, incl. after a cancellation that refunded) must NOT refund.
    if (outcome === 'rejected') {
      // Late, wrong amount or booking gone: nothing was confirmed, give the money back.
      const existing = await this.payments.findOne({
        stripePaymentIntentId: intent.id,
      });
      if (existing?.status === 'refunded' || existing?.stripeRefundId) {
        return; // already refunded; the idempotency key only lasts 24h
      }
      const userId = intent.metadata?.userId || existing?.userId?.toString();
      if (!userId) {
        throw new InternalServerErrorException(
          `PaymentIntent ${intent.id} has no user to refund`,
        );
      }
      // A Refund record (PAY-03), so the refund webhooks find it and the
      // user is told (GEN-01). The payment only counts as refunded once
      // Stripe says the money went back.
      const refund = await this.refunds.refundRejectedPayment({
        bookingType: ref.type,
        bookingId: ref.bookingId,
        userId,
        paymentIntentId: intent.id,
        amount: fromMinorUnits(intent.amount_received),
        currency: intent.currency.toUpperCase(),
      });
      await this.payments.updateOne(
        { stripePaymentIntentId: intent.id },
        {
          $set: {
            stripeRefundId: refund.refundId,
            ...(refund.status === 'REFUNDED' ? { status: 'refunded' } : {}),
          },
        },
      );
      return;
    }
    await this.setStatus(intent, 'succeeded');
  }

  /** A rejected payment's refund went through: the payment is now refunded. */
  private async onRefundSettled(refund: Stripe.Refund): Promise<void> {
    if (toRefundStatus(refund.status) !== 'REFUNDED') return;
    await this.payments.updateOne(
      { stripeRefundId: refund.id, status: { $ne: 'refunded' } },
      { $set: { status: 'refunded' } },
    );
  }

  private async onFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const ref = readReference(intent);
    if (!ref) return;
    await this.gateway.recordFailure(ref.type, ref.bookingId, intent.id);
    await this.setStatus(intent, 'requires_payment_method');
  }

  private async setStatus(
    intent: Stripe.PaymentIntent,
    status: string,
  ): Promise<void> {
    // Stripe does not guarantee event order: a late `payment_failed` or
    // `canceled` must never overwrite `succeeded`/`refunded`. The only exit
    // from a final state is succeeded -> refunded.
    const blocked = status === 'refunded' ? ['refunded'] : FINAL_STATES;
    await this.payments.updateOne(
      { stripePaymentIntentId: intent.id, status: { $nin: blocked } },
      { $set: { status } },
    );
  }

  private async findOwned(
    userId: string,
    paymentId: string,
  ): Promise<PaymentDocument> {
    const doc = Types.ObjectId.isValid(paymentId)
      ? await this.payments.findById(paymentId)
      : null;
    if (!doc || doc.userId.toString() !== userId) {
      throw new NotFoundException('Payment not found');
    }
    return doc;
  }
}

function readReference(
  intent: Stripe.PaymentIntent,
): { type: BookingType; bookingId: string } | null {
  const { bookingType, bookingId } = intent.metadata ?? {};
  const type = BOOKING_TYPES.find((t) => t === bookingType);
  if (!type || !bookingId) return null;
  return { type, bookingId };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/** Stripe refuses to cancel an intent that already succeeded or was cancelled. */
function isStripeUnexpectedState(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'payment_intent_unexpected_state'
  );
}

function toView(p: PaymentDocument): PaymentView {
  return {
    paymentId: p.id,
    bookingType: p.bookingType,
    bookingId: p.bookingId.toString(),
    amount: p.amount,
    currency: p.currency,
    status: p.status,
  };
}
