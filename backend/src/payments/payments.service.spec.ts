import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type Stripe from 'stripe';
import { BookingPaymentGateway } from './booking-payment-gateway';
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
    refunds: { create: jest.fn().mockResolvedValue({}) },
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
  const service = new PaymentsService(
    stripe as unknown as Stripe,
    config,
    payments as never,
    gateway as unknown as BookingPaymentGateway,
    policies as unknown as PolicyAcceptanceService,
  );
  return { service, stripe, payments, gateway, policies };
}

function event(type: string, object: Stripe.PaymentIntent): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

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
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('refunds a payment the booking could not accept (idempotent key)', async () => {
    const { service, stripe, gateway } = setup();
    gateway.confirm.mockResolvedValue('rejected');
    stripe.webhooks.constructEvent.mockReturnValue(
      event('payment_intent.succeeded', intent({ status: 'succeeded' })),
    );
    await service.handleWebhook(Buffer.from('{}'), 'sig');
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1' },
      { idempotencyKey: 'refund-rejected-pi_1' },
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
    await service.cancelPendingPayment('flight', BOOKING);
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1');
  });

  it('never cancels a payment that already succeeded', async () => {
    const { service, stripe, payments } = setup();
    payments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      stripePaymentIntentId: 'pi_1',
      status: 'succeeded',
    });
    await service.cancelPendingPayment('flight', BOOKING);
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
    await expect(
      service.cancelPendingPayment('flight', BOOKING),
    ).resolves.toBeUndefined();
  });
});
