import { BadRequestException } from '@nestjs/common';
import type { InventoryRoom } from './hotel-inventory';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How long a Pending Payment reservation holds its rooms (HTL-18). */
export const HOLD_MINUTES = 10;

/** Stay dates are calendar dates, stored as midnight UTC. */
export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Every night of the stay: check-in up to, not including, check-out. */
export function nightsOf(checkIn: Date, checkOut: Date): Date[] {
  const nights: Date[] = [];
  for (let t = checkIn.getTime(); t < checkOut.getTime(); t += MS_PER_DAY) {
    nights.push(new Date(t));
  }
  return nights;
}

function fieldError(
  field: string,
  message: string,
  code: string,
): BadRequestException {
  return new BadRequestException({
    message,
    code,
    errors: [{ field, messages: [message] }],
  });
}

/** Check-out after check-in, check-in not in the past (HTL-18). */
export function assertValidStay(
  checkIn: Date,
  checkOut: Date,
  now: Date,
): void {
  if (checkIn.getTime() < startOfUtcDay(now).getTime()) {
    throw fieldError(
      'checkIn',
      'Check-in cannot be in the past',
      'CHECK_IN_IN_PAST',
    );
  }
  if (checkOut.getTime() <= checkIn.getTime()) {
    throw fieldError(
      'checkOut',
      'Check-out must be after check-in',
      'CHECK_OUT_NOT_AFTER_CHECK_IN',
    );
  }
}

export interface RoomGuests {
  roomId: string;
  adults: number;
  childrenAges: number[];
}

/** At least one adult in the reservation, at least one guest per room (HTL-16). */
export function assertGuests(rooms: RoomGuests[]): void {
  if (!rooms.some((room) => room.adults > 0)) {
    throw fieldError(
      'rooms',
      'A reservation needs at least one adult',
      'NO_ADULT',
    );
  }
  rooms.forEach((room, index) => {
    if (room.adults + room.childrenAges.length === 0) {
      throw fieldError(
        `rooms.${index}`,
        'Every room needs at least one guest',
        'EMPTY_ROOM',
      );
    }
  });
}

export interface PricedRoom extends RoomGuests {
  name: string;
  type?: string;
  pricePerNight: number;
  subtotal: number;
}

/**
 * Matches the requested rooms to the inventory, checks each is bookable and
 * not over its maximum occupancy, and prices it at today's price (HTL-16).
 */
export function priceRooms(
  requested: RoomGuests[],
  inventory: InventoryRoom[],
  nights: number,
): { rooms: PricedRoom[]; total: number } {
  const byId = new Map(inventory.map((room) => [room.id, room]));
  const rooms = requested.map((wanted, index): PricedRoom => {
    const room = byId.get(wanted.roomId);
    if (!room) {
      throw fieldError(
        `rooms.${index}.roomId`,
        'This room does not belong to the selected hotel',
        'ROOM_NOT_IN_HOTEL',
      );
    }
    if (!room.bookable) {
      throw fieldError(
        `rooms.${index}.roomId`,
        `Room ${room.name} is not available for these dates`,
        'ROOM_NOT_AVAILABLE',
      );
    }
    const guests = wanted.adults + wanted.childrenAges.length;
    if (guests > room.maxOccupancy) {
      throw fieldError(
        `rooms.${index}`,
        `Room ${room.name} sleeps at most ${room.maxOccupancy} guests`,
        'OVER_OCCUPANCY',
      );
    }
    return {
      ...wanted,
      name: room.name,
      ...(room.type ? { type: room.type } : {}),
      pricePerNight: room.pricePerNight,
      subtotal: roundMoney(room.pricePerNight * nights),
    };
  });
  const total = roundMoney(rooms.reduce((sum, room) => sum + room.subtotal, 0));
  return { rooms, total };
}

/** Prices are in the platform currency with two decimals. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
