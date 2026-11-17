import { BadRequestException } from '@nestjs/common';
import type { InventoryRoom } from './hotel-inventory';
import { ReservationStatus, canTransition } from './reservation-status';
import {
  assertGuests,
  assertValidStay,
  formatDate,
  MAX_NIGHTS,
  nightsOf,
  parseDate,
  priceRooms,
} from './stay-rules';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { code?: string }).code;
    }
    throw error;
  }
  return undefined;
}

const room = (overrides: Partial<InventoryRoom> = {}): InventoryRoom => ({
  id: 'r1',
  hotelId: 'h1',
  name: '101',
  type: 'Double',
  maxOccupancy: 3,
  pricePerNight: 120,
  bookable: true,
  ...overrides,
});

describe('hotel stay rules (HTL-16, HTL-18)', () => {
  const now = new Date('2027-03-01T15:30:00.000Z');

  it('lists every night from check-in up to, not including, check-out', () => {
    const nights = nightsOf(parseDate('2027-03-01'), parseDate('2027-03-04'));
    expect(nights.map(formatDate)).toEqual([
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
    ]);
  });

  it('accepts check-in today and rejects check-in in the past', () => {
    expect(
      codeOf(() =>
        assertValidStay(parseDate('2027-03-01'), parseDate('2027-03-02'), now),
      ),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        assertValidStay(parseDate('2027-02-28'), parseDate('2027-03-02'), now),
      ),
    ).toBe('CHECK_IN_IN_PAST');
  });

  it('requires check-out after check-in', () => {
    expect(
      codeOf(() =>
        assertValidStay(parseDate('2027-03-05'), parseDate('2027-03-05'), now),
      ),
    ).toBe('CHECK_OUT_NOT_AFTER_CHECK_IN');
  });

  it('allows a stay of exactly the maximum number of nights', () => {
    const checkIn = parseDate('2027-03-01');
    const checkOut = new Date(checkIn.getTime() + MAX_NIGHTS * 86_400_000);
    expect(
      codeOf(() => assertValidStay(checkIn, checkOut, now)),
    ).toBeUndefined();
  });

  it('rejects a stay longer than the maximum before any night is generated', () => {
    const checkIn = parseDate('2027-03-01');
    const checkOut = new Date(
      checkIn.getTime() + (MAX_NIGHTS + 1) * 86_400_000,
    );
    expect(codeOf(() => assertValidStay(checkIn, checkOut, now))).toBe(
      'STAY_TOO_LONG',
    );
    expect(
      codeOf(() =>
        assertValidStay(parseDate('2027-03-01'), parseDate('9999-12-31'), now),
      ),
    ).toBe('STAY_TOO_LONG');
  });

  it('needs at least one adult in the reservation, not in every room', () => {
    expect(
      codeOf(() =>
        assertGuests([
          { roomId: 'r1', adults: 2, childrenAges: [] },
          { roomId: 'r2', adults: 0, childrenAges: [12, 14] },
        ]),
      ),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        assertGuests([{ roomId: 'r1', adults: 0, childrenAges: [5] }]),
      ),
    ).toBe('NO_ADULT');
    expect(
      codeOf(() =>
        assertGuests([
          { roomId: 'r1', adults: 1, childrenAges: [] },
          { roomId: 'r2', adults: 0, childrenAges: [] },
        ]),
      ),
    ).toBe('EMPTY_ROOM');
  });

  it('prices each room as nights x its own price and sums them', () => {
    const result = priceRooms(
      [
        { roomId: 'r1', adults: 2, childrenAges: [] },
        { roomId: 'r2', adults: 1, childrenAges: [4] },
      ],
      [room(), room({ id: 'r2', name: '102', pricePerNight: 99.99 })],
      3,
    );
    expect(result.rooms.map((r) => r.subtotal)).toEqual([360, 299.97]);
    expect(result.total).toBe(659.97);
  });

  it('rejects a room over its maximum occupancy (children count)', () => {
    expect(
      codeOf(() =>
        priceRooms(
          [{ roomId: 'r1', adults: 2, childrenAges: [3, 9] }],
          [room()],
          1,
        ),
      ),
    ).toBe('OVER_OCCUPANCY');
  });

  it('rejects rooms of another hotel and rooms that are not bookable', () => {
    expect(
      codeOf(() =>
        priceRooms(
          [{ roomId: 'other', adults: 1, childrenAges: [] }],
          [room()],
          1,
        ),
      ),
    ).toBe('ROOM_NOT_IN_HOTEL');
    expect(
      codeOf(() =>
        priceRooms(
          [{ roomId: 'r1', adults: 1, childrenAges: [] }],
          [room({ bookable: false })],
          1,
        ),
      ),
    ).toBe('ROOM_NOT_AVAILABLE');
  });
});

describe('reservation lifecycle (GEN-11)', () => {
  it.each([
    [ReservationStatus.PENDING_PAYMENT, ReservationStatus.CONFIRMED, true],
    [ReservationStatus.PENDING_PAYMENT, ReservationStatus.EXPIRED, true],
    [ReservationStatus.CONFIRMED, ReservationStatus.COMPLETED, true],
    [ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED, true],
    [ReservationStatus.PENDING_PAYMENT, ReservationStatus.CANCELLED, false],
    [ReservationStatus.EXPIRED, ReservationStatus.CONFIRMED, false],
    [ReservationStatus.CANCELLED, ReservationStatus.CONFIRMED, false],
    [ReservationStatus.COMPLETED, ReservationStatus.CANCELLED, false],
  ])('%s -> %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });
});
