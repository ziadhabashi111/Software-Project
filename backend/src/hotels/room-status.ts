import { covers } from './date-ranges';
import type { BookableRoom } from './date-ranges';

export type NightStatus = 'Available' | 'Booked' | 'Blocked';

/** Why a night is Blocked: the moderator blocked it, the room is off, or it was never offered. */
export type BlockedReason = 'BLOCKED' | 'DEACTIVATED' | 'NOT_OFFERED';

export interface NightInfo {
  status: NightStatus;
  /** Booked only: the reservation reference, `null` while it is an unpaid hold. */
  reference?: string | null;
  /** Booked only. */
  reservationId?: string;
  /** Blocked only. */
  reason?: BlockedReason;
}

/**
 * HTL-08: one room on one night. A reservation always wins (Booked, with its
 * reference); otherwise the night is Blocked when it is not open for booking,
 * and Available when it is.
 */
export function nightStatus(
  room: BookableRoom,
  night: Date,
  booking?: { reservationId: string; reference: string | null },
): NightInfo {
  if (booking) {
    return {
      status: 'Booked',
      reference: booking.reference,
      reservationId: booking.reservationId,
    };
  }
  if (covers(room.blocked, night))
    return { status: 'Blocked', reason: 'BLOCKED' };
  if (!room.isActive) return { status: 'Blocked', reason: 'DEACTIVATED' };
  if (!covers(room.availability, night)) {
    return { status: 'Blocked', reason: 'NOT_OFFERED' };
  }
  return { status: 'Available' };
}
