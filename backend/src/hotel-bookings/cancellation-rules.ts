import { ConflictException } from '@nestjs/common';
import { refundPercentFor } from '../flights/airline-policies';
import { ReservationStatus } from './reservation-status';
import { effectiveStatus } from './reservation-view';
import type { HotelReservationDocument } from './schemas/hotel-reservation.schema';
import { formatDate, roundMoney, startOfUtcDay } from './stay-rules';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** What cancelling now would refund (HTL-21). */
export interface RefundQuote {
  reservationId: string;
  checkIn: string;
  /** Whole days from today to the check-in date. */
  daysBeforeCheckIn: number;
  totalPrice: number;
  refundPercent: number;
  refundAmount: number;
  currency: string;
}

/** Whole calendar days from today (UTC) until the check-in date. */
export function daysBeforeCheckIn(checkIn: Date, now: Date): number {
  return Math.round(
    (checkIn.getTime() - startOfUtcDay(now).getTime()) / MS_PER_DAY,
  );
}

/**
 * HTL-21: only a Confirmed reservation, only as a whole, and only before the
 * check-in date. Throws 409 with a reason code otherwise.
 */
export function assertCancellable(
  doc: HotelReservationDocument,
  now: Date,
): void {
  if (effectiveStatus(doc, now) !== ReservationStatus.CONFIRMED) {
    throw new ConflictException({
      message: 'Only a Confirmed reservation can be cancelled',
      code: 'NOT_CANCELLABLE',
    });
  }
  if (daysBeforeCheckIn(doc.checkIn, now) < 1) {
    throw new ConflictException({
      message: 'A reservation can only be cancelled before its check-in date',
      code: 'CHECK_IN_REACHED',
    });
  }
}

/**
 * The refund on the full total, using the tier rule shared with flights
 * (FLT-09 / HTL-10): the tier with the highest threshold not above the days
 * remaining, 0% when none applies.
 */
export function quoteRefund(
  doc: HotelReservationDocument,
  now: Date,
): RefundQuote {
  const days = daysBeforeCheckIn(doc.checkIn, now);
  const refundPercent = refundPercentFor(doc.cancellationTiers, days);
  return {
    reservationId: doc.id,
    checkIn: formatDate(doc.checkIn),
    daysBeforeCheckIn: days,
    totalPrice: doc.totalPrice,
    refundPercent,
    refundAmount: roundMoney((doc.totalPrice * refundPercent) / 100),
    currency: doc.currency,
  };
}
