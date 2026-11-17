/**
 * GEN-11 booking lifecycle for hotel reservations:
 * Pending Payment -> Confirmed -> Completed, Pending Payment -> Expired,
 * Confirmed -> Cancelled. Nothing else.
 *
 * The values match the strings the admin booking list filters on (ACC-17).
 * When Ziad publishes the shared booking-status enum, re-export it from here
 * so the rest of this module does not change.
 */
export enum ReservationStatus {
  PENDING_PAYMENT = 'Pending Payment',
  CONFIRMED = 'Confirmed',
  COMPLETED = 'Completed',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
}

const ALLOWED: Record<ReservationStatus, ReservationStatus[]> = {
  [ReservationStatus.PENDING_PAYMENT]: [
    ReservationStatus.CONFIRMED,
    ReservationStatus.EXPIRED,
  ],
  [ReservationStatus.CONFIRMED]: [
    ReservationStatus.COMPLETED,
    ReservationStatus.CANCELLED,
  ],
  [ReservationStatus.COMPLETED]: [],
  [ReservationStatus.EXPIRED]: [],
  [ReservationStatus.CANCELLED]: [],
};

export function canTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/** Statuses whose rooms are taken for their nights (HTL-06, HTL-11, HTL-18). */
export const ROOM_HOLDING_STATUSES = [
  ReservationStatus.PENDING_PAYMENT,
  ReservationStatus.CONFIRMED,
];
