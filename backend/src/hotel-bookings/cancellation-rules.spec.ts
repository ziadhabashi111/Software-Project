import { ConflictException } from '@nestjs/common';
import {
  assertCancellable,
  daysBeforeCheckIn,
  quoteRefund,
} from './cancellation-rules';
import { ReservationStatus } from './reservation-status';
import type { HotelReservationDocument } from './schemas/hotel-reservation.schema';

const now = new Date('2027-03-01T18:00:00.000Z');
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

function reservation(
  overrides: Partial<Record<string, unknown>> = {},
): HotelReservationDocument {
  return {
    id: 'r1',
    status: ReservationStatus.CONFIRMED,
    checkIn: day('2027-03-11'),
    checkOut: day('2027-03-13'),
    totalPrice: 333.33,
    currency: 'USD',
    cancellationTiers: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 10 },
    ],
    ...overrides,
  } as unknown as HotelReservationDocument;
}

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConflictException) {
      return (error.getResponse() as { code?: string }).code;
    }
    throw error;
  }
  return undefined;
}

describe('hotel cancellation rules (HTL-21, HTL-10)', () => {
  it('counts whole calendar days to check-in, whatever the time of day', () => {
    expect(daysBeforeCheckIn(day('2027-03-11'), now)).toBe(10);
    expect(daysBeforeCheckIn(day('2027-03-02'), now)).toBe(1);
    expect(daysBeforeCheckIn(day('2027-03-01'), now)).toBe(0);
  });

  it.each([
    ['2027-04-30', 100, 333.33],
    ['2027-03-31', 100, 333.33], // exactly 30 days
    ['2027-03-30', 50, 166.67], // 29 days: the 7-day tier
    ['2027-03-08', 50, 166.67], // exactly 7 days
    ['2027-03-07', 10, 33.33], // 6 days: the 0-day tier
  ])(
    'check-in %s refunds %d%% of the full total',
    (checkIn, percent, amount) => {
      const quote = quoteRefund(reservation({ checkIn: day(checkIn) }), now);
      expect(quote.refundPercent).toBe(percent);
      expect(quote.refundAmount).toBe(amount);
    },
  );

  it('refunds 0% when no tier applies or the hotel has none', () => {
    expect(
      quoteRefund(
        reservation({
          checkIn: day('2027-03-03'),
          cancellationTiers: [{ daysBefore: 7, refundPercent: 50 }],
        }),
        now,
      ).refundAmount,
    ).toBe(0);
    expect(
      quoteRefund(reservation({ cancellationTiers: [] }), now).refundPercent,
    ).toBe(0);
  });

  it('allows cancelling a Confirmed reservation before the check-in date only', () => {
    expect(codeOf(() => assertCancellable(reservation(), now))).toBeUndefined();
    expect(
      codeOf(() =>
        assertCancellable(reservation({ checkIn: day('2027-03-01') }), now),
      ),
    ).toBe('CHECK_IN_REACHED');
  });

  it.each([
    ReservationStatus.PENDING_PAYMENT,
    ReservationStatus.CANCELLED,
    ReservationStatus.EXPIRED,
    ReservationStatus.COMPLETED,
  ])('refuses a %s reservation', (status) => {
    expect(
      codeOf(() =>
        assertCancellable(
          reservation({ status, holdExpiresAt: new Date('2030-01-01') }),
          now,
        ),
      ),
    ).toBe('NOT_CANCELLABLE');
  });
});
