import { ConflictException } from '@nestjs/common';
/**
 * GEN-11: the one shared booking lifecycle.
 * Used by flight bookings and hotel reservations alike.
 */
export enum BookingStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

/**
 * The only legal moves. Anything not listed here is forbidden.
 * COMPLETED, EXPIRED and CANCELLED are final: nothing leaves them.
 */
export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.CANCELLED]: [],
};

/** True when moving from `from` to `to` is one of the allowed transitions. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws a 409 Conflict when the move is not allowed; does nothing otherwise. */
export function assertCanTransition(
  from: BookingStatus,
  to: BookingStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`Booking cannot change from ${from} to ${to}`);
  }
}
