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

export interface CancellationTerms extends UserRefundQuote {
  /** True when the airline cancelled one of the flights (FLT-06: 100%). */
  byAirline: boolean;
}

/**
 * What cancelling a booking now means, in one place for the cancel route,
 * the details preview and the refund service. If the airline cancelled one
 * of its flights (its cancellation may not have reached this booking yet),
 * the refund is the FLT-06 100% and departure does not block it. Otherwise
 * the user's FLT-26 rules apply: Confirmed, before the outbound departs, on
 * the outbound airline's tiers.
 */
export function cancellationTerms(
  booking: {
    status: BookingStatus;
    total: number;
    perSegment: number[];
    tiers: { daysBefore: number; refundPercent: number }[];
  },
  segments: { departureUtc: Date; cancelled: boolean }[],
  now: Date,
): CancellationTerms {
  const outbound = segments[0];
  if (booking.status !== BookingStatus.CONFIRMED || !outbound) {
    assertUserCancellable(booking.status, outbound?.departureUtc ?? now, now);
  }
  if (segments.some((s) => s.cancelled)) {
    const outboundFlown =
      !outbound.cancelled && outbound.departureUtc.getTime() <= now.getTime();
    return {
      byAirline: true,
      daysBeforeDeparture: daysBeforeDeparture(outbound.departureUtc, now),
      refundPercent: 100,
      refundAmount: airlineRefundAmount(
        booking.total,
        booking.perSegment,
        outboundFlown,
      ),
    };
  }
  assertUserCancellable(booking.status, outbound.departureUtc, now);
  return {
    byAirline: false,
    ...quoteUserRefund(
      booking.total,
      booking.tiers,
      outbound.departureUtc,
      now,
    ),
  };
}
