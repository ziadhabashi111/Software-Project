/**
 * PAY-03: a short, safe reason for a failed refund. Stripe's error code when
 * it has one (e.g. `charge_already_refunded` -> `STRIPE_CHARGE_ALREADY_REFUNDED`),
 * otherwise `REFUND_ISSUE_FAILED`. Never a message, stack or secret.
 *
 * Same rule as hotel bookings' `refundFailureReason`; kept as a local copy so
 * flight bookings does not import from the hotel-bookings module.
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
