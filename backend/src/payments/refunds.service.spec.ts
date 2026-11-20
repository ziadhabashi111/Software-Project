import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type Stripe from 'stripe';
import type { BookingPaymentGateway } from './booking-payment-gateway';
import { RefundsService, toRefundStatus } from './refunds.service';

const USER = new Types.ObjectId().toString();
const OTHER_USER = new Types.ObjectId().toString();
const BOOKING = new Types.ObjectId().toString();

function basis(over: Record<string, unknown> = {}) {
  return {
    bookingId: BOOKING,
    userId: USER,
    paymentIntentId: 'pi_1',
    amount: 166.67,
    percentage: 50,
    currency: 'USD',
    status: 'PENDING',
    stripeRefundId: null,
    idempotencyKey: 'refund-flight-key',
    failureReason: null,
    ...over,
  };
}

function refundDoc(over: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    bookingType: 'flight',
    bookingId: new Types.ObjectId(BOOKING),
    userId: new Types.ObjectId(USER),
    stripePaymentIntentId: 'pi_1',
    stripeRefundId: 're_1',
    amount: 166.67,
    percentage: 50,
    currency: 'USD',
    status: 'REFUNDED',
    ...over,
  };
}

function stripeRefund(over: Partial<Stripe.Refund> = {}): Stripe.Refund {
  return {
    id: 're_1',
    status: 'succeeded',
    failure_reason: null,
    ...over,
  } as Stripe.Refund;
}

function setup() {
  const stripe = {
    refunds: {
      create: jest.fn().mockResolvedValue(stripeRefund()),
      retrieve: jest.fn().mockResolvedValue(stripeRefund()),
    },
  };
  const model = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    exists: jest.fn().mockResolvedValue(null),
  };
  const gateway = {
    refundQuote: jest.fn(),
    refundBasis: jest.fn().mockResolvedValue(basis()),
    recordRefund: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new RefundsService(
    stripe as unknown as Stripe,
    model as never,
    gateway as unknown as BookingPaymentGateway,
    notifications,
  );
  return { service, stripe, model, gateway, notifications };
}

describe('toRefundStatus', () => {
  it('maps Stripe statuses to ours', () => {
    expect(toRefundStatus('succeeded')).toBe('REFUNDED');
    expect(toRefundStatus('failed')).toBe('FAILED');
    expect(toRefundStatus('canceled')).toBe('FAILED');
    expect(toRefundStatus('pending')).toBe('PENDING');
    expect(toRefundStatus('requires_action')).toBe('PENDING');
    expect(toRefundStatus(null)).toBe('PENDING');
  });
});

describe('RefundsService.preview (PAY-03)', () => {
  it('returns the percent, amount and currency from the booking module', async () => {
    const { service, gateway } = setup();
    gateway.refundQuote.mockResolvedValue({
      refundPercent: 50,
      refundAmount: 166.67,
      currency: 'USD',
    });
    await expect(service.preview('hotel', BOOKING)).resolves.toEqual({
      refundPercent: 50,
      refundAmount: 166.67,
      currency: 'USD',
    });
    expect(gateway.refundQuote).toHaveBeenCalledWith('hotel', BOOKING);
  });

  it('is a 404 when the booking has no quote', async () => {
    const { service, gateway } = setup();
    gateway.refundQuote.mockResolvedValue(null);
    await expect(service.preview('flight', BOOKING)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('RefundsService.issue (PAY-03)', () => {
  it('creates a Stripe refund of the fixed amount in cents, with the booking idempotency key', async () => {
    const { service, stripe, model } = setup();
    model.findOneAndUpdate
      .mockResolvedValueOnce(refundDoc()) // save (upsert)
      .mockResolvedValueOnce(refundDoc()); // notify claim
    const result = await service.issue('flight', BOOKING);
    const [params, options] = stripe.refunds.create.mock.calls[0] as [
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    expect(params.payment_intent).toBe('pi_1');
    expect(params.amount).toBe(16667);
    expect(params.metadata).toEqual({
      bookingType: 'flight',
      bookingId: BOOKING,
      userId: USER,
    });
    expect(options).toEqual({ idempotencyKey: 'refund-flight-key' });
    expect(result).toEqual({
      refundId: 're_1',
      amount: 166.67,
      status: 'REFUNDED',
      currency: 'USD',
    });
  });

  it('reads back a refund that already went out instead of creating another', async () => {
    const { service, stripe, gateway, model } = setup();
    gateway.refundBasis.mockResolvedValue(basis({ stripeRefundId: 're_1' }));
    model.findOneAndUpdate
      .mockResolvedValueOnce(refundDoc())
      .mockResolvedValueOnce(null);
    await service.issue('flight', BOOKING);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(stripe.refunds.retrieve).toHaveBeenCalledWith('re_1');
  });

  it('keeps a Pending refund Pending and does not notify yet', async () => {
    const { service, stripe, model, notifications } = setup();
    stripe.refunds.create.mockResolvedValue(
      stripeRefund({ status: 'pending' }),
    );
    model.findOneAndUpdate.mockResolvedValueOnce(
      refundDoc({ status: 'PENDING' }),
    );
    const result = await service.issue('hotel', BOOKING);
    expect(result.status).toBe('PENDING');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('notifies the user once when the refund is final', async () => {
    const { service, model, notifications } = setup();
    model.findOneAndUpdate
      .mockResolvedValueOnce(refundDoc())
      .mockResolvedValueOnce(refundDoc()); // claim won
    await service.issue('flight', BOOKING);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      USER,
      'REFUND_ISSUED',
      expect.stringContaining('166.67 USD'),
    );
  });

  it('does not notify again when the claim was already taken', async () => {
    const { service, model, notifications } = setup();
    model.findOneAndUpdate
      .mockResolvedValueOnce(refundDoc())
      .mockResolvedValueOnce(null); // someone else already notified
    await service.issue('flight', BOOKING);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('is a 404 when no refund is due', async () => {
    const { service, gateway, stripe } = setup();
    gateway.refundBasis.mockResolvedValue(null);
    await expect(service.issue('flight', BOOKING)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('never calls Stripe for a zero amount', async () => {
    const { service, gateway, stripe } = setup();
    gateway.refundBasis.mockResolvedValue(basis({ amount: 0 }));
    await expect(service.issue('flight', BOOKING)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('survives a concurrent duplicate insert (unique booking record)', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }))
      .mockResolvedValueOnce(null);
    model.findOne.mockResolvedValue(refundDoc());
    await expect(service.issue('flight', BOOKING)).resolves.toMatchObject({
      refundId: 're_1',
    });
  });
});

describe('RefundsService.onStripeRefund webhook (PAY-03)', () => {
  it('moves a Pending refund to Refunded, updates the booking and notifies', async () => {
    const { service, model, gateway, notifications } = setup();
    const doc = refundDoc({ status: 'REFUNDED' });
    model.findOneAndUpdate
      .mockResolvedValueOnce(doc) // pending -> refunded
      .mockResolvedValueOnce(doc); // notify claim
    await service.onStripeRefund(stripeRefund({ status: 'succeeded' }));
    const calls = model.findOneAndUpdate.mock.calls as unknown[][];
    expect(calls[0][0]).toEqual({
      stripeRefundId: 're_1',
      status: 'PENDING',
    });
    expect(gateway.recordRefund).toHaveBeenCalledWith('flight', BOOKING, {
      refundId: 're_1',
      amount: 166.67,
      status: 'REFUNDED',
      currency: 'USD',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      USER,
      'REFUND_ISSUED',
      expect.any(String),
    );
  });

  it('records a failure with its reason and tells the user', async () => {
    const { service, model, notifications } = setup();
    const doc = refundDoc({ status: 'FAILED' });
    model.findOneAndUpdate
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce(doc);
    await service.onStripeRefund(
      stripeRefund({
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      }),
    );
    const calls = model.findOneAndUpdate.mock.calls as unknown[][];
    expect(calls[0][1]).toEqual({
      $set: { status: 'FAILED', failureReason: 'expired_or_canceled_card' },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      USER,
      'REFUND_FAILED',
      expect.any(String),
    );
  });

  it('ignores a replayed event for an already final refund', async () => {
    const { service, model, gateway, notifications } = setup();
    model.findOneAndUpdate.mockResolvedValueOnce(null);
    model.exists.mockResolvedValue({ _id: new Types.ObjectId() });
    await expect(
      service.onStripeRefund(stripeRefund()),
    ).resolves.toBeUndefined();
    expect(gateway.recordRefund).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('fails when our record is missing so Stripe retries the event', async () => {
    const { service, model } = setup();
    model.findOneAndUpdate.mockResolvedValueOnce(null);
    model.exists.mockResolvedValue(null);
    await expect(service.onStripeRefund(stripeRefund())).rejects.toThrow(
      /not recorded yet/,
    );
  });

  it('does nothing for a still-pending Stripe refund', async () => {
    const { service, model } = setup();
    await service.onStripeRefund(stripeRefund({ status: 'pending' }));
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('RefundsService.refundRejectedPayment (PAY-03, GEN-01)', () => {
  const rejected = {
    bookingType: 'flight' as const,
    bookingId: BOOKING,
    userId: USER,
    paymentIntentId: 'pi_late',
    amount: 250.5,
    currency: 'USD',
  };

  it('refunds the whole payment once and keeps a Refund record for the refund webhooks', async () => {
    const { service, stripe, model } = setup();
    model.findOne.mockResolvedValue(null);
    const doc = refundDoc({
      kind: 'rejected_payment',
      stripePaymentIntentId: 'pi_late',
      amount: 250.5,
      percentage: 100,
    });
    model.findOneAndUpdate
      .mockResolvedValueOnce(doc) // save
      .mockResolvedValueOnce(doc); // notify claim
    const result = await service.refundRejectedPayment(rejected);
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_late',
        metadata: {
          bookingType: 'flight',
          bookingId: BOOKING,
          userId: USER,
          reason: 'payment_rejected',
        },
      },
      { idempotencyKey: 'refund-rejected-pi_late' },
    );
    const [filter, update] = model.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $setOnInsert: Record<string, unknown> },
    ];
    expect(filter).toEqual({ stripeRefundId: 're_1' });
    expect(update.$setOnInsert).toMatchObject({
      kind: 'rejected_payment',
      bookingType: 'flight',
      stripePaymentIntentId: 'pi_late',
      amount: 250.5,
      percentage: 100,
      currency: 'USD',
      status: 'REFUNDED',
    });
    expect(result.status).toBe('REFUNDED');
  });

  it('tells the user their payment was not accepted and was refunded', async () => {
    const { service, model, notifications } = setup();
    model.findOne.mockResolvedValue(null);
    const doc = refundDoc({ kind: 'rejected_payment', amount: 250.5 });
    model.findOneAndUpdate
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce(doc);
    await service.refundRejectedPayment(rejected);
    expect(notifications.notify).toHaveBeenCalledWith(
      USER,
      'PAYMENT_REFUNDED',
      expect.stringContaining('250.5 USD'),
    );
  });

  it('never refunds the same payment twice', async () => {
    const { service, stripe, model } = setup();
    model.findOne.mockResolvedValue(
      refundDoc({ kind: 'rejected_payment', stripePaymentIntentId: 'pi_late' }),
    );
    await service.refundRejectedPayment(rejected);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('a refund.failed webhook for it is recorded and the user is told, without touching the booking', async () => {
    const { service, model, gateway, notifications } = setup();
    const doc = refundDoc({
      kind: 'rejected_payment',
      status: 'FAILED',
      failureReason: 'expired_or_canceled_card',
    });
    model.findOneAndUpdate
      .mockResolvedValueOnce(doc)
      .mockResolvedValueOnce(doc);
    await service.onStripeRefund(
      stripeRefund({
        status: 'failed',
        failure_reason: 'expired_or_canceled_card',
      }),
    );
    expect(gateway.recordRefund).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(
      USER,
      'REFUND_FAILED',
      expect.any(String),
    );
  });
});

describe('RefundsService.get (PAY-03)', () => {
  it('returns your own refund by its Stripe id', async () => {
    const { service, model } = setup();
    model.findOne.mockResolvedValue(refundDoc());
    await expect(service.get(USER, 're_1')).resolves.toMatchObject({
      refundId: 're_1',
      bookingType: 'flight',
      bookingId: BOOKING,
      amount: 166.67,
      status: 'REFUNDED',
    });
  });

  it('also finds it by our own id', async () => {
    const { service, model } = setup();
    const doc = refundDoc();
    model.findById.mockResolvedValue(doc);
    await service.get(USER, doc._id.toString());
    expect(model.findById).toHaveBeenCalled();
  });

  it("is a 404 for someone else's refund", async () => {
    const { service, model } = setup();
    model.findOne.mockResolvedValue(refundDoc());
    await expect(service.get(OTHER_USER, 're_1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is a 404 for an unknown refund', async () => {
    const { service, model } = setup();
    model.findOne.mockResolvedValue(null);
    await expect(service.get(USER, 're_nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
