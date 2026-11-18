import { ConflictException } from '@nestjs/common';
import { BookingStatus } from '../../common/booking-status/booking-status';
import {
  airlineRefundAmount,
  assertUserCancellable,
  daysBeforeDeparture,
  quoteUserRefund,
} from './cancellation-rules';

const NOW = new Date('2026-11-18T10:00:00Z');
const DAY = 86_400_000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY);
const TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
];

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return ((error as ConflictException).getResponse() as { code?: string })
      .code;
  }
  return undefined;
}

describe('cancellation rules (FLT-26, FLT-09, FLT-12a, FLT-06)', () => {
  it('counts whole days before departure, never below 0', () => {
    expect(daysBeforeDeparture(inDays(10.9), NOW)).toBe(10);
    expect(daysBeforeDeparture(inDays(0.5), NOW)).toBe(0);
    expect(daysBeforeDeparture(inDays(-1), NOW)).toBe(0);
  });

  it.each([
    [40, 100, 500],
    [10, 50, 250],
    [3, 0, 0],
  ])('%i days out refunds %i%% of 500', (days, percent, amount) => {
    expect(quoteUserRefund(500, TIERS, inDays(days), NOW)).toEqual({
      daysBeforeDeparture: days,
      refundPercent: percent,
      refundAmount: amount,
    });
  });

  it('0 days before departure uses the 0-day tier or 0%', () => {
    const departure = new Date(NOW.getTime() + 23 * 3_600_000);
    expect(
      quoteUserRefund(
        100,
        [{ daysBefore: 0, refundPercent: 10 }],
        departure,
        NOW,
      ).refundAmount,
    ).toBe(10);
    expect(quoteUserRefund(100, [], departure, NOW).refundPercent).toBe(0);
  });

  it('rounds the refund to cents', () => {
    expect(
      quoteUserRefund(
        99.99,
        [{ daysBefore: 0, refundPercent: 33 }],
        inDays(5),
        NOW,
      ).refundAmount,
    ).toBe(33);
  });

  it('only a Confirmed booking can be cancelled', () => {
    expect(
      errorCode(() =>
        assertUserCancellable(BookingStatus.PENDING_PAYMENT, inDays(5), NOW),
      ),
    ).toBe('NOT_CANCELLABLE');
  });

  it('blocks cancellation once the outbound has departed', () => {
    expect(
      errorCode(() =>
        assertUserCancellable(BookingStatus.CONFIRMED, inDays(-0.01), NOW),
      ),
    ).toBe('ALREADY_DEPARTED');
  });

  it('allows a Confirmed booking before departure', () => {
    expect(() =>
      assertUserCancellable(BookingStatus.CONFIRMED, inDays(1), NOW),
    ).not.toThrow();
  });

  it('an airline cancellation refunds everything, or only the unflown return', () => {
    expect(airlineRefundAmount(433, [240, 193], false)).toBe(433);
    expect(airlineRefundAmount(433, [240, 193], true)).toBe(193);
  });
});
