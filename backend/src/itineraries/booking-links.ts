import { BookingStatus } from '../common/booking-status/booking-status';
import type { FlightBookingView } from '../flight-bookings/flight-booking-view';
import type { HotelReservationView } from '../hotel-bookings/reservation-view';
import { BudgetCategory } from './budget/budget-categories';

/** ITN-27: what kind of booking is linked to an itinerary day. */
export enum LinkedBookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

/** What the itinerary shows about a linked booking, read from the booking right now. */
export interface BookingFacts {
  reference: string | null;
  title: string;
  status: BookingStatus;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD` */
  endDate: string;
  amount: number;
  /** Bookings are priced in the platform currency and are never converted here. */
  currency: string;
}

/** Only a booking that really exists for the traveller can be planned around. */
export function isLinkable(status: BookingStatus): boolean {
  return (
    status === BookingStatus.CONFIRMED || status === BookingStatus.COMPLETED
  );
}

/** The route (every leg), flight numbers, date span and total of a flight booking. */
export function describeFlight(
  view: Pick<
    FlightBookingView,
    'reference' | 'status' | 'segments' | 'price' | 'currency'
  >,
): BookingFacts {
  const first = view.segments[0];
  const last = view.segments[view.segments.length - 1];
  const route = [
    first.departure.airport.iataCode,
    ...view.segments.map((segment) => segment.arrival.airport.iataCode),
  ].join(' → ');
  const numbers = view.segments.map((segment) => segment.flightNumber);
  return {
    reference: view.reference,
    title: `${route} · ${numbers.join(', ')}`,
    status: view.status,
    startDate: first.departure.localDate,
    endDate: last.arrival.localDate,
    amount: view.price.total,
    currency: view.currency,
  };
}

/** The hotel, stay dates and total of a hotel reservation. */
export function describeHotel(
  view: Pick<
    HotelReservationView,
    | 'reference'
    | 'status'
    | 'hotel'
    | 'checkIn'
    | 'checkOut'
    | 'totalPrice'
    | 'currency'
  >,
): BookingFacts {
  return {
    reference: view.reference,
    title: view.hotel.name,
    status: view.status,
    startDate: view.checkIn,
    endDate: view.checkOut,
    amount: view.totalPrice,
    currency: view.currency,
  };
}

export interface LinkedLine {
  dayId: string;
  type: LinkedBookingType;
  facts: BookingFacts;
}

/**
 * ITN-27: the budget lines that linked bookings add. A flight is intercity
 * transport and a hotel stay is accommodation, both on the day they are linked
 * to, in the booking's own currency (converted when the summary is shown, like
 * every other line). A booking that is no longer confirmed adds nothing.
 */
export function budgetLines(lines: LinkedLine[]): {
  entries: {
    dayId: string;
    category: BudgetCategory;
    amount: number;
    currency: string;
  }[];
  transportCosts: { dayId: string; amount: number; currency: string }[];
} {
  const live = lines.filter((line) => isLinkable(line.facts.status));
  return {
    entries: live
      .filter((line) => line.type === LinkedBookingType.HOTEL)
      .map((line) => ({
        dayId: line.dayId,
        category: BudgetCategory.ACCOMMODATION,
        amount: line.facts.amount,
        currency: line.facts.currency,
      })),
    transportCosts: live
      .filter((line) => line.type === LinkedBookingType.FLIGHT)
      .map((line) => ({
        dayId: line.dayId,
        amount: line.facts.amount,
        currency: line.facts.currency,
      })),
  };
}
