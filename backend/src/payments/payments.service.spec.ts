import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type Stripe from 'stripe';
import { BookingPaymentGateway } from './booking-payment-gateway';
import { fromMinorUnits } from './money';
import { PaymentsService, toMinorUnits } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';

const USER = new Types.ObjectId().toString();
const BOOKING = new Types.ObjectId().toString();

function intent(
  over: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: 'pi_1',
    status: 'requires_payment_method',
    client_secret: 'secret_1',
    amount_received: 25050,
    currency: 'usd',
    metadata: { bookingType: 'flight', bookingId: BOOKING, userId: USER },
    ...over,
  } as Stripe.PaymentIntent;
}

function setup() {
  const stripe = {
    paymentIntents: {
      create: jest.fn().mockResolvedValue(intent()),
      retrieve: jest.fn(),
      cancel: jest.fn().mockResolvedValue({}),
    },
    refunds: { create: jest.fn().mockResolvedValue({ id: 're_1' }) },
    webhooks: { constructEvent: jest.fn() },
  };
  const paymentDoc = {
    id: 'pay_1',
    _id: new Types.ObjectId(),
    bookingType: 'flight',
    bookingId: new Types.ObjectId(BOOKING),
    userId: new Types.ObjectId(USER),
    amount: 250.5,
    currency: 'USD',
    status: 'requires_payment_method',
    attempts: 1,
  };
  const payments = {
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(paymentDoc),
    findOneAndUpdate: jest.fn().mockResolvedValue(paymentDoc),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const gateway = {
    payable: jest.fn().mockResolvedValue({
      bookingId: BOOKING,
      amount: 250.5,
      currency: 'USD',
      holdExpiresAt: new Date('2026-11-18T12:00:00Z'),
      description: 'Flight booking',
      paymentIntentId: null,
    }),
    attach: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    confirm: jest.fn().mockResolvedValue('confirmed'),
  };
  const policies = { assertAccepted: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn().mockReturnValue('whsec_test'),
  } as unknown as ConfigService;
  // Behaves like the unique index on eventId.
  const seenEvents = new Set<string>();
  const processedEvents = {
    create: jest.fn((doc: { eventId: string }) => {
      if (seenEvents.has(doc.eventId)) {
        return Promise.reject(
          Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
        );
      }
      seenEvents.add(doc.eventId);
      return Promise.resolve(doc);
    }),
    deleteOne: jest.fn((filter: { eventId: string }) => {
      seenEvents.delete(filter.eventId);
      return Promise.resolve({});
    }),
    exists: jest.fn((filter: { eventId: string }) =>
      Promise.resolve(seenEvents.has(filter.eventId) ? { _id: 'x' } : null),
    ),
  };
  const refunds = {
    onStripeRefund: jest.fn().mockResolvedValue(undefined),
    refundRejectedPayment: jest.fn().mockResolvedValue({
      refundId: 're_1',
      amount: 250.5,
      status: 'REFUNDED',
      currency: 'USD',
    }),
  };
  const service = new PaymentsService(
    stripe as unknown as Stripe,
    config,
    payments as never,
    gateway as unknown as BookingPaymentGateway,
    policies as unknown as PolicyAcceptanceService,
    processedEvents as never,
    refunds as never,
  );
  return {
    service,
    stripe,
    payments,
    gateway,
    policies,
    processedEvents,
    paymentDoc,
    refunds,
  };
}

/** `created` is when Stripe generated the event, i.e. when the payment succeeded. */
function event(
  type: string,
  object: Stripe.PaymentIntent,
  id = 'evt_1',
): Stripe.Event {
  return {
    id,
    type,
    created: 1_795_000_000,
    data: { object },
  } as unknown as Stripe.Event;
}

/** Minimal evaluator for the `updateOne` filters used by setStatus. */
interface StatusFilter {
  stripePaymentIntentId: string;
  status?: { $nin?: string[]; $ne?: string };
}
function fakeUpdateOne(doc: { status: string }, intentId = 'pi_1') {
  return (filter: StatusFilter, update: { $set: { status: string } }) => {
    const s = filter.status;
    const matches =
      filter.stripePaymentIntentId === intentId &&
      !(s?.$nin && s.$nin.includes(doc.status)) &&
      !(s?.$ne !== undefined && s.$ne === doc.status);
    if (matches) doc.status = update.$set.status;
    return Promise.resolve({ matchedCount: matches ? 1 : 0 });
  };
}

describe('fromMinorUnits', () => {
  it('converts Stripe cents back to major units', () => {
    expect(fromMinorUnits(25050)).toBe(250.5);
    expect(fromMinorUnits(toMinorUnits(19.99))).toBe(19.99);
  });
});

describe('toMinorUnits', () => {
  it('converts major units to cents without float drift', () => {
    expect(toMinorUnits(250.5)).toBe(25050);
    expect(toMinorUnits(19.99)).toBe(1999);
  });
});

describe('PaymentsService.start (PAY-01)', () => {
  it('creates a PaymentIntent in cents and returns the client secret', async () => {
    const { service, stripe, gateway } = setup();
    const view = await service.start(USER, 'flight', BOOKING);
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 25050, currency: 'usd' }),
      { idempotencyKey: `pi-flight-${BOOKING}-1` },
    );
    expect(gateway.attach).toHaveBeenCalledWith(
      'flight',
      BOOKING,
      'pi_1',
      'requires_payment_method',
    );
    expect(view.clientSecret).toBe('secret_1');
  });

  it('blocks payment until the policies are accepted', async () => {
    const { service, policies, stripe } = setup();
    policies.assertAccepted.mockRejectedValue(new ConflictException());
    await expect(service.start(USER, 'flight', BOOKING)).rejects.toThrow(
      ConflictException,
    );
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('passes through the 404/409 of a booking that is not payable', async () => {
    const { service, gateway, stripe } = setup();
    gateway.payable.mockRejectedValue(new NotFoundException());
    await expect(
      service.start('someone-else', 'flight', BOOKING),
    ).rejects.toThrow(NotFoundException);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('reuses the open PaymentIntent of the same hold (retry)', async () => {
    const { service, stripe, gateway } = setup();
    gateway.payable.mockResolvedValue({
      ...(await gateway.payable()),
      paymentIntentId: 'pi_1',
    });
    stripe.paymentIntents.retrieve.mockResolvedValue(intent());
    await service.start(USER, 'flight', BOOKING);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('creates a new PaymentIntent with a new key when the old one was cancelled', async () => {
    const { service, stripe, gateway, payments } = setup();
    gateway.payable.mockResolvedValue({
      ...(await gateway.payable()),
      paymentIntentId: 'pi_old',
    });
    stripe.paymentIntents.retrieve.mockResolvedValue(
      intent({ id: 'pi_old', status: 'canceled' }),
    );
    payments.findOne.mockResolvedValue({ attempts: 1 });
    await service.start(USER, 'flight', BOOKING);
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.anything(),
      { idempotencyKey: `pi-flight-${BOOKING}-2` },
    );
  });

  it('refuses to pay twice for a booking that already succeeded', async () => {
    const { service, stripe, gateway } = setup();
    gateway.payable.mockResolvedValue({
      ...(await gateway.payable()),
      paymentIntentId: 'pi_1',
    });
    stripe.paymentIntents.retrieve.mockResolvedValue(
      intent({ status: 'succeeded' }),
    );
    await expect(service.start(USER, 'flight', BOOKING)).rejects.toThrow(
      ConflictException,
    );
  });

  it('answers two parallel first requests with the same payment (no 500 on E11000)', async () => {
    const { service, payments, paymentDoc } = setup();
    let stored = false;
    payments.findOne.mockImplementation(() =>
      Promise.resolve(stored ? paymentDoc : null),
    );
    payments.findOneAndUpdate.mockImplementation(() => {
      if (stored) {
        return Promise.reject(
          Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
        );
      }
      stored = true;
      return Promise.resolve(paymentDoc);
    });
    const [a, b] = await Promise.all([
      service.start(USER, 'flight', BOOKING),
      service.start(USER, 'flight', BOOKING),
    ]);
    expect(a.paymentId).toBe('pay_1');
    expect(b).toEqual(a);
  });

  it('still surfaces database errors other than a duplicate key', async () => {
    const { service, payments } = setup();
    payments.findOneAndUpdate.mockRejectedValue(new Error('db down'));
    await expect(service.start(USER, 'flight', BOOKING)).rejects.toThrow(
      'db down',
    );
  });
});

describe('PaymentsService.get / retry ownership', () => {
  it("answers 404 for another user's payment", async () => {
    const { service } = setup();
    await expect(service.get('another-user', 'pay_1')).rejects.toThrow();
    await expect(
      service.get(
        new Types.ObjectId().toString(),
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PaymentsService.handleWebhook (PAY-01)', () => {
  it('rejects a bad signature with 400 and confirms nothing', async () => {
    const { service, stripe, gateway } = setup();
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('bad signature');
    });
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toThrow(BadRequestException);
    expect(gateway.confirm).not.toHaveBeenCalled();
  });

  it('rejects a missing signature header', async () => {
    const { service } = setup();
    await expect(
      service.handleWebhook(Buffer.from('{}'), undefined),
    ).rejects.toThrow(BadRequestException);
  });

  it('confirms the booking from a verified succeeded event, without refund', async () => {
    const { service, stripe, gateway } = setup();
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(gateway.confirm).toHaveBeenCalledWith('flight', BOOKING, {
      paymentIntentId: 'pi_1',
      amount: 250.5,
      currency: 'USD',
      paidAt: new Date(1_795_000_000 * 1000),
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('refunds a payment the booking could not accept through the refund records', async () => {
    const { service, stripe, gateway, refunds } = setup();
    gateway.confirm.mockResolvedValue('rejected');
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(refunds.refundRejectedPayment).toHaveBeenCalledWith({
      bookingType: 'flight',
      bookingId: BOOKING,
      userId: USER,
      paymentIntentId: 'pi_1',
      amount: 250.5,
      currency: 'USD',
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('keeps the payment succeeded while its refund is still pending', async () => {
    const { service, stripe, gateway, refunds, payments } = setup();
    gateway.confirm.mockResolvedValue('rejected');
    refunds.refundRejectedPayment.mockResolvedValue({
      refundId: 're_1',
      amount: 250.5,
      status: 'PENDING',
      currency: 'USD',
    });
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(payments.updateOne).toHaveBeenCalledWith(
      { stripePaymentIntentId: 'pi_1' },
      { $set: { stripeRefundId: 're_1' } },
    );
  });

  it('marks the payment refunded once the refund webhook says it went through', async () => {
    const { service, stripe, payments } = setup();
    stripe.webhooks.constructEvent.mockReturnValue({
      id: 'evt_refund',
      type: 'refund.updated',
      created: 1,
      data: { object: { id: 're_1', status: 'succeeded' } },
    });
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(payments.updateOne).toHaveBeenCalledWith(
      { stripeRefundId: 're_1', status: { $ne: 'refunded' } },
      { $set: { status: 'refunded' } },
    );
  });

  it('does not refund when the same event is delivered again', async () => {
    const { service, stripe, gateway } = setup();
    gateway.confirm.mockResolvedValue('already_confirmed');
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('does not refund a replay after cancellation (already_processed)', async () => {
    const { service, stripe, gateway } = setup();
    gateway.confirm.mockResolvedValue('already_processed');
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(gateway.confirm).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('acknowledges a duplicate event id without processing it again', async () => {
    const { service, stripe, gateway } = setup();
    gateway.confirm.mockResolvedValue('rejected');
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).resolves.toEqual({ received: true });
    expect(gateway.confirm).toHaveBeenCalledTimes(1);
  });

  it('releases the event claim when processing fails, so a Stripe retry is processed', async () => {
    const { service, stripe, gateway } = setup();
    gateway.confirm.mockRejectedValueOnce(new Error('db down'));
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toThrow('db down');
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(gateway.confirm).toHaveBeenCalledTimes(2);
  });

  it('processes a Stripe retry when the server died while handling the first delivery', async () => {
    const { service, stripe, gateway, processedEvents } = setup();
    // The process dies mid-handling: no cleanup code runs at all.
    processedEvents.deleteOne.mockImplementation(() => Promise.resolve({}));
    gateway.confirm.mockRejectedValueOnce(new Error('process killed'));
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await expect(
      service.handleWebhook(Buffer.from('{}'), 'sig'),
    ).rejects.toThrow('process killed');
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(gateway.confirm).toHaveBeenCalledTimes(2);
  });

  it('records the event as processed only after it was handled', async () => {
    const { service, stripe, gateway, processedEvents } = setup();
    const order: string[] = [];
    gateway.confirm.mockImplementation(() => {
      order.push('handled');
      return Promise.resolve('confirmed');
    });
    processedEvents.create.mockImplementation((doc: { eventId: string }) => {
      order.push('recorded');
      return Promise.resolve(doc);
    });
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(order).toEqual(['handled', 'recorded']);
  });

  it('never refunds a payment that is already refunded (beyond the 24h idempotency window)', async () => {
    const { service, stripe, gateway, payments, refunds } = setup();
    gateway.confirm.mockResolvedValue('rejected');
    payments.findOne.mockResolvedValue({
      stripePaymentIntentId: 'pi_1',
      status: 'refunded',
      stripeRefundId: 're_1',
    });
    // A different event id for the same intent (e.g. a manual resend).
    stripe.webhooks.constructEvent.mockReturnValue(
      event(
        'payment_intent.succeeded',
        intent({ status: 'succeeded' }),
        'evt_2',
      ),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(refunds.refundRejectedPayment).not.toHaveBeenCalled();
  });

  it('stores the refund id and marks the payment refunded when the refund went through', async () => {
    const { service, stripe, gateway, payments } = setup();
    gateway.confirm.mockResolvedValue('rejected');
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(payments.updateOne).toHaveBeenCalledWith(
      { stripePaymentIntentId: 'pi_1' },
      { $set: { stripeRefundId: 're_1', status: 'refunded' } },
    );
  });

  it('keeps a succeeded payment succeeded when a late payment_failed arrives', async () => {
    const { service, stripe, payments } = setup();
    const doc = { status: 'succeeded' };
    payments.updateOne.mockImplementation(fakeUpdateOne(doc));
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.payment_failed', intent(), 'evt_late_fail'),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(doc.status).toBe('succeeded');

    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.canceled', intent(), 'evt_late_cancel'),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(doc.status).toBe('succeeded');
  });

  it('still moves a pending payment to failed, and a refunded one never back', async () => {
    const { service, stripe, payments } = setup();
    const pending = { status: 'processing' };
    payments.updateOne.mockImplementation(fakeUpdateOne(pending));
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.payment_failed', intent(), 'evt_fail'),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(pending.status).toBe('requires_payment_method');

    const refunded = { status: 'refunded' };
    payments.updateOne.mockImplementation(fakeUpdateOne(refunded));
    stripe.webhooks.constructEvent.mockReturnValue(
      event(
        'payment_intent.succeeded',
        intent({ status: 'succeeded' }),
        'evt_ok',
      ),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(refunded.status).toBe('refunded');
  });

  it('records a failed payment and leaves the booking unconfirmed', async () => {
    const { service, stripe, gateway } = setup();
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.payment_failed', intent()),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(gateway.recordFailure).toHaveBeenCalledWith(
      'flight',
      BOOKING,
      'pi_1',
    );
    expect(gateway.confirm).not.toHaveBeenCalled();
  });

  it('ignores events without booking metadata', async () => {
    const { service, stripe, gateway } = setup();
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ metadata: {} })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(gateway.confirm).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.cancelPendingPayment', () => {
  it('cancels the open PaymentIntent when the hold expires', async () => {
    const { service, stripe, payments } = setup();
    payments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      stripePaymentIntentId: 'pi_1',
      status: 'requires_payment_method',
    });
    await expect(service.cancelPendingPayment('flight', BOOKING)).resolves.toBe(
      'cancelled',
    );
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1');
  });

  it('answers none when the booking has no PaymentIntent', async () => {
    const { service } = setup();
    await expect(service.cancelPendingPayment('flight', BOOKING)).resolves.toBe(
      'none',
    );
  });

  it('never cancels a payment that already succeeded', async () => {
    const { service, stripe, payments } = setup();
    payments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      stripePaymentIntentId: 'pi_1',
      status: 'succeeded',
    });
    await expect(service.cancelPendingPayment('flight', BOOKING)).resolves.toBe(
      'not_cancellable',
    );
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
  });

  it('never throws when Stripe fails', async () => {
    const { service, stripe, payments } = setup();
    payments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      stripePaymentIntentId: 'pi_1',
      status: 'requires_payment_method',
    });
    stripe.paymentIntents.cancel.mockRejectedValue(new Error('stripe down'));
    await expect(service.cancelPendingPayment('flight', BOOKING)).resolves.toBe(
      'error',
    );
  });

  it('warns (not errors) when the intent already succeeded and cannot be cancelled', async () => {
    const { service, stripe, payments } = setup();
    payments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      stripePaymentIntentId: 'pi_1',
      status: 'requires_payment_method',
    });
    stripe.paymentIntents.cancel.mockRejectedValue(
      Object.assign(new Error('unexpected state'), {
        code: 'payment_intent_unexpected_state',
      }),
    );
    const logger = (
      service as unknown as {
        logger: { warn: jest.Mock; error: jest.Mock };
      }
    ).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const error = jest
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    stripe.paymentIntents.retrieve.mockResolvedValue(
      intent({ status: 'succeeded' }),
    );
    await expect(service.cancelPendingPayment('flight', BOOKING)).resolves.toBe(
      'not_cancellable',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(payments.updateOne).not.toHaveBeenCalled();
  });

  it('answers cancelled when Stripe says the intent was already cancelled', async () => {
    const { service, stripe, payments } = setup();
    payments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      stripePaymentIntentId: 'pi_1',
      status: 'requires_payment_method',
    });
    stripe.paymentIntents.cancel.mockRejectedValue(
      Object.assign(new Error('unexpected state'), {
        code: 'payment_intent_unexpected_state',
      }),
    );
    stripe.paymentIntents.retrieve.mockResolvedValue(
      intent({ status: 'canceled' }),
    );
    await expect(service.cancelPendingPayment('flight', BOOKING)).resolves.toBe(
      'cancelled',
    );
  });
});
