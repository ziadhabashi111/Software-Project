import { refundFailureReason } from './hotel-cancellations.service';

describe('refundFailureReason (PAY-03)', () => {
  it("uses Stripe's error code when there is one", () => {
    const error = Object.assign(new Error('Your card was declined'), {
      code: 'charge_already_refunded',
    });
    expect(refundFailureReason(error)).toBe('STRIPE_CHARGE_ALREADY_REFUNDED');
  });

  it('never stores a message, stack or secret', () => {
    const reason = refundFailureReason(
      new Error('Invalid API Key provided: sk_test_123'),
    );
    expect(reason).toBe('REFUND_ISSUE_FAILED');
    expect(refundFailureReason('sk_live_abc')).toBe('REFUND_ISSUE_FAILED');
    expect(refundFailureReason(null)).toBe('REFUND_ISSUE_FAILED');
  });

  it('ignores a code that is not a short identifier', () => {
    expect(refundFailureReason({ code: 'has spaces and sk_test_1' })).toBe(
      'REFUND_ISSUE_FAILED',
    );
    expect(refundFailureReason({ code: 402 })).toBe('REFUND_ISSUE_FAILED');
  });
});
