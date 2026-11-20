import type { BookingStatus } from '../common/booking-status/booking-status';
import { isLinkable } from './booking-links';
import type { BookingFacts, LinkedBookingType } from './booking-links';

/** A booking linked to a day of an itinerary, with its details right now (ITN-27). */
export interface LinkedBookingView {
  /** Id of the link; use it to remove the link. */
  id: string;
  bookingType: LinkedBookingType;
  bookingId: string;
  dayId: string;
  /** The day's position (from 1), or null if the day no longer exists. */
  dayNumber: number | null;
  reference: string | null;
  title: string;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  amount: number;
  currency: string;
  /** False once the booking is cancelled or expired: it no longer feeds the budget. */
  counted: boolean;
}

export function toLinkedBookingView(
  link: {
    id: string;
    dayId: { toString(): string };
    bookingId: { toString(): string };
    bookingType: LinkedBookingType;
  },
  facts: BookingFacts,
  dayNumber: number | null,
): LinkedBookingView {
  return {
    id: link.id,
    bookingType: link.bookingType,
    bookingId: link.bookingId.toString(),
    dayId: link.dayId.toString(),
    dayNumber,
    reference: facts.reference,
    title: facts.title,
    status: facts.status,
    startDate: facts.startDate,
    endDate: facts.endDate,
    amount: facts.amount,
    currency: facts.currency,
    counted: isLinkable(facts.status),
  };
}
