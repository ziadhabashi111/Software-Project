import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingPaymentGateway } from './booking-payment-gateway';
import type { PaymentService } from './payment.service.interface';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import type { BookingType } from './refund.service.interface';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { STRIPE_CLIENT } from './stripe.provider';

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

/** Stripe wants the smallest currency unit (cents). */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

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
    const payment = await this.payments.findOneAndUpdate(
      { bookingType: type, bookingId: new Types.ObjectId(bookingId) },
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
  ): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(bookingId)) return;
      const payment = await this.payments.findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
      });
      if (!payment?.stripePaymentIntentId) return;
      if (['succeeded', 'canceled', 'refunded'].includes(payment.status))
        return;
      await this.stripe.paymentIntents.cancel(payment.stripePaymentIntentId);
      await this.payments.updateOne(
        { _id: payment._id, status: { $nin: ['succeeded', 'refunded'] } },
        { $set: { status: 'canceled' } },
      );
    } catch (error) {
      this.logger.error(
        `Could not cancel the PaymentIntent of ${bookingType} ${bookingId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * POST /payments/webhook: the only place a booking becomes Confirmed.
   * The signature is checked against the RAW body; Stripe retries are safe
   * because `confirmPaid` is idempotent and the refund uses an idempotency key.
   */
  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new InternalServerErrorException(
        'Webhook secret is not configured',
      );
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

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.onSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.onFailed(event.data.object);
        break;
      case 'payment_intent.canceled':
        await this.setStatus(event.data.object, 'canceled');
        break;
      default:
        break; // other events are not needed for PAY-01
    }
    return { received: true };
  }

  private async onSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
    const ref = readReference(intent);
    if (!ref) return;
    const outcome = await this.gateway.confirm(ref.type, ref.bookingId, {
      paymentIntentId: intent.id,
      amount: intent.amount_received / 100,
      currency: intent.currency.toUpperCase(),
    });
    if (outcome === 'rejected') {
      // Late, wrong amount or booking gone: nothing was confirmed, give the money back.
      await this.stripe.refunds.create(
        { payment_intent: intent.id },
        { idempotencyKey: `refund-rejected-${intent.id}` },
      );
      await this.setStatus(intent, 'refunded');
      return;
    }
    await this.setStatus(intent, 'succeeded');
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
    await this.payments.updateOne(
      { stripePaymentIntentId: intent.id, status: { $ne: 'refunded' } },
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
  if ((bookingType !== 'flight' && bookingType !== 'hotel') || !bookingId) {
    return null;
  }
  return { type: bookingType, bookingId };
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
