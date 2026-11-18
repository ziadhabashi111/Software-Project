import { flightRefundIdempotencyKey } from './flight-booking-payments';
import { refundFailureReason } from './refund-failure-reason';

describe('refundFailureReason (PAY-03)', () => {
  it("uses Stripe's error code when there is one", () => {
    const error = Object.assign(new Error('Your card was declined'), {
      code: 'charge_already_refunded',
    });
    expect(refundFailureReason(error)).toBe('STRIPE_CHARGE_ALREADY_REFUNDED');
  });

  it('never stores a message, stack or secret', () => {
    expect(
      refundFailureReason(new Error('Invalid API Key provided: sk_test_123')),
    ).toBe('REFUND_ISSUE_FAILED');
    expect(refundFailureReason('sk_live_abc')).toBe('REFUND_ISSUE_FAILED');
    expect(refundFailureReason(null)).toBe('REFUND_ISSUE_FAILED');
    expect(refundFailureReason(undefined)).toBe('REFUND_ISSUE_FAILED');
  });

  it('ignores a code that is not a short identifier', () => {
    expect(refundFailureReason({ code: 'has spaces and sk_test_1' })).toBe(
      'REFUND_ISSUE_FAILED',
    );
    expect(refundFailureReason({ code: 'x'.repeat(65) })).toBe(
      'REFUND_ISSUE_FAILED',
    );
    expect(refundFailureReason({ code: 402 })).toBe('REFUND_ISSUE_FAILED');
  });
});

describe('flightRefundIdempotencyKey (PAY-03)', () => {
  it('is stable per booking', () => {
    expect(flightRefundIdempotencyKey('abc123')).toBe(
      'flight-booking-refund-abc123',
    );
  });
});
