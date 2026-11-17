import { BookingStatus } from '../common/booking-status/booking-status';

/**
 * GEN-11: hotel reservations use the shared booking lifecycle published by
 * the payments module (Ziad). Re-exported under the name this module uses.
 */
export {
  BookingStatus as ReservationStatus,
  assertCanTransition,
  canTransition,
} from '../common/booking-status/booking-status';

/** Statuses whose rooms are taken for their nights (HTL-06, HTL-11, HTL-18). */
export const ROOM_HOLDING_STATUSES = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
];
