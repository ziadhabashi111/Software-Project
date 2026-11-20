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
