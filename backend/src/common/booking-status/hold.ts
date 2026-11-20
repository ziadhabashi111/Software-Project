/**
 * The Pending Payment hold shared by flight bookings (FLT-22) and hotel
 * reservations (HTL-18): the user has this long to pay before the seats or
 * rooms are released. One constant, so both modules and their messages agree.
 */
export const HOLD_MINUTES = 10;

const HOLD_MS = HOLD_MINUTES * 60_000;

/** When a hold that starts at `now` ends. */
export function holdExpiresAt(now: Date): Date {
  return new Date(now.getTime() + HOLD_MS);
}

/** The message of the 409 HOLD_EXPIRED answer. */
export function holdExpiredMessage(): string {
  return `The ${HOLD_MINUTES}-minute hold has expired. Start a new booking.`;
}

/**
 * Stripe retries a webhook for up to 3 days. A run-out hold whose payment
 * Stripe already took is left to the webhook for this long, then expired
 * anyway, so seats and rooms are never held forever (FLT-22, HTL-18).
 */
export const STRIPE_WEBHOOK_RETRY_MS = 3 * 24 * 60 * 60 * 1000;
