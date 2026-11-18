import { BookingStatus } from '../../common/booking-status/booking-status';

/**
 * Stored statuses are Ziad's GEN-11 enum (`PENDING_PAYMENT`). Youssef's
 * FLT-29 rows and the admin filter (ACC-17) use display labels such as
 * `Confirmed`; this accepts either form. Unknown -> null.
 */
export function parseStatus(value: string): BookingStatus | null {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (Object.values(BookingStatus) as string[]).includes(key)
    ? (key as BookingStatus)
    : null;
}

/** `PENDING_PAYMENT` -> `Pending Payment`. */
export function statusLabel(status: BookingStatus): string {
  return status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
