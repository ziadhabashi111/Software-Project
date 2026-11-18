import { ConflictException } from '@nestjs/common';
import { BookingStatus } from '../../common/booking-status/booking-status';
import { refundPercentFor } from '../../flights/airline-policies';
import { roundMoney } from './pricing';

const MS_PER_DAY = 86_400_000;

export interface UserRefundQuote {
  /** Whole days left before the outbound departs. */
  daysBeforeDeparture: number;
  refundPercent: number;
  refundAmount: number;
}

/** Whole 24-hour periods until departure (my call), never below 0. */
export function daysBeforeDeparture(departureUtc: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((departureUtc.getTime() - now.getTime()) / MS_PER_DAY),
  );
}

/**
 * FLT-26: only your own Confirmed booking, and only before the outbound
 * departs (a round trip is cancelled as a whole, FLT-12a).
 */
export function assertUserCancellable(
  status: BookingStatus,
  outboundDepartureUtc: Date,
  now: Date,
): void {
  if (status !== BookingStatus.CONFIRMED) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'Only a Confirmed booking can be cancelled',
      code: 'NOT_CANCELLABLE',
    });
  }
  if (outboundDepartureUtc.getTime() <= now.getTime()) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message:
        'This flight has already departed and can no longer be cancelled',
      code: 'ALREADY_DEPARTED',
    });
  }
}

/**
 * FLT-26 / FLT-09: the outbound airline's tier (snapshot taken at booking)
 * for the days remaining, applied to the full total.
 */
export function quoteUserRefund(
  total: number,
  tiers: { daysBefore: number; refundPercent: number }[],
  outboundDepartureUtc: Date,
  now: Date,
): UserRefundQuote {
  const days = daysBeforeDeparture(outboundDepartureUtc, now);
  const refundPercent = refundPercentFor(tiers, days);
  return {
    daysBeforeDeparture: days,
    refundPercent,
    refundAmount: roundMoney((total * refundPercent) / 100),
  };
}

/**
 * FLT-06: the airline cancelled a flight, so the refund is 100%. If the
 * outbound has already been flown and the return is cancelled, only the
 * return leg is refunded (my call).
 */
export function airlineRefundAmount(
  total: number,
  perSegment: number[],
  outboundDeparted: boolean,
): number {
  return outboundDeparted && perSegment.length > 1
    ? roundMoney(perSegment[1])
    : roundMoney(total);
}
