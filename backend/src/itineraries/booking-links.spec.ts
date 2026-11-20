import { BookingStatus } from '../common/booking-status/booking-status';
import type { FlightBookingView } from '../flight-bookings/flight-booking-view';
import type { HotelReservationView } from '../hotel-bookings/reservation-view';
import { BudgetCategory } from './budget/budget-categories';
import {
  budgetLines,
  describeFlight,
  describeHotel,
  isLinkable,
  LinkedBookingType,
} from './booking-links';
import type { BookingFacts } from './booking-links';

function flightView(overrides: Record<string, unknown> = {}) {
  const leg = (from: string, to: string, number: string, day: string) => ({
    flightNumber: number,
    departure: { airport: { iataCode: from }, localDate: day },
    arrival: { airport: { iataCode: to }, localDate: day },
  });
  return {
    reference: 'FB-ABC123',
    status: BookingStatus.CONFIRMED,
    segments: [leg('CAI', 'JFK', 'EG123', '2027-03-10')],
    price: { total: 840 },
    currency: 'USD',
    ...overrides,
  } as unknown as FlightBookingView;
}

function hotelView(overrides: Record<string, unknown> = {}) {
  return {
    reference: 'HB-XYZ789',
    status: BookingStatus.CONFIRMED,
    hotel: { id: 'h1', name: 'Nile View Hotel' },
    checkIn: '2027-03-10',
    checkOut: '2027-03-13',
    totalPrice: 450,
    currency: 'USD',
    ...overrides,
  } as unknown as HotelReservationView;
}

describe('isLinkable (ITN-27)', () => {
  it.each([BookingStatus.CONFIRMED, BookingStatus.COMPLETED])(
    'accepts a %s booking',
    (status) => expect(isLinkable(status)).toBe(true),
  );

  // Only a booking that really exists for the traveller can sit in a plan.
  it.each([
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.EXPIRED,
    BookingStatus.CANCELLED,
  ])('refuses a %s booking', (status) =>
    expect(isLinkable(status)).toBe(false),
  );
});

describe('describeFlight', () => {
  it('names the route and flight and reads the dates and price off the booking', () => {
    expect(describeFlight(flightView())).toEqual<BookingFacts>({
      reference: 'FB-ABC123',
      title: 'CAI → JFK · EG123',
      status: BookingStatus.CONFIRMED,
      startDate: '2027-03-10',
      endDate: '2027-03-10',
      amount: 840,
      currency: 'USD',
    });
  });

  // A round trip is one booking with two segments: the route shows both legs
  // and the dates run from the first departure to the last arrival.
  it('shows the whole route and date span of a round trip', () => {
    const view = flightView({
      segments: [
        {
          flightNumber: 'EG123',
          departure: { airport: { iataCode: 'CAI' }, localDate: '2027-03-10' },
          arrival: { airport: { iataCode: 'JFK' }, localDate: '2027-03-10' },
        },
        {
          flightNumber: 'EG124',
          departure: { airport: { iataCode: 'JFK' }, localDate: '2027-03-17' },
          arrival: { airport: { iataCode: 'CAI' }, localDate: '2027-03-18' },
        },
      ],
    });
    const facts = describeFlight(view);
    expect(facts.title).toBe('CAI → JFK → CAI · EG123, EG124');
    expect(facts.startDate).toBe('2027-03-10');
    expect(facts.endDate).toBe('2027-03-18');
  });

  it('keeps a missing reference as null', () => {
    expect(
      describeFlight(flightView({ reference: null })).reference,
    ).toBeNull();
  });
});

describe('describeHotel', () => {
  it('names the hotel and reads the stay and total off the reservation', () => {
    expect(describeHotel(hotelView())).toEqual<BookingFacts>({
      reference: 'HB-XYZ789',
      title: 'Nile View Hotel',
      status: BookingStatus.CONFIRMED,
      startDate: '2027-03-10',
      endDate: '2027-03-13',
      amount: 450,
      currency: 'USD',
    });
  });
});

describe('budgetLines (ITN-27: linked bookings feed the budget)', () => {
  const flight = (dayId: string, status = BookingStatus.CONFIRMED) => ({
    dayId,
    type: LinkedBookingType.FLIGHT,
    facts: describeFlight(flightView({ status })),
  });
  const hotel = (dayId: string, status = BookingStatus.CONFIRMED) => ({
    dayId,
    type: LinkedBookingType.HOTEL,
    facts: describeHotel(hotelView({ status })),
  });

  it('counts a flight as intercity transport on its day', () => {
    expect(budgetLines([flight('d1')])).toEqual({
      entries: [],
      transportCosts: [{ dayId: 'd1', amount: 840, currency: 'USD' }],
    });
  });

  it('counts a hotel stay as accommodation on its day', () => {
    expect(budgetLines([hotel('d2')])).toEqual({
      entries: [
        {
          dayId: 'd2',
          category: BudgetCategory.ACCOMMODATION,
          amount: 450,
          currency: 'USD',
        },
      ],
      transportCosts: [],
    });
  });

  // A booking cancelled after it was linked must stop counting at once, or the
  // plan would still show money that went back to the traveller.
  it('stops counting a booking that is no longer confirmed', () => {
    const lines = budgetLines([
      flight('d1', BookingStatus.CANCELLED),
      hotel('d2', BookingStatus.EXPIRED),
      hotel('d3', BookingStatus.PENDING_PAYMENT),
    ]);
    expect(lines).toEqual({ entries: [], transportCosts: [] });
  });

  it('still counts a completed trip', () => {
    expect(
      budgetLines([hotel('d1', BookingStatus.COMPLETED)]).entries,
    ).toHaveLength(1);
  });

  it('adds nothing for no linked bookings', () => {
    expect(budgetLines([])).toEqual({ entries: [], transportCosts: [] });
  });

  it('keeps every booking as its own line, in the booking’s currency', () => {
    const lines = budgetLines([flight('d1'), flight('d1'), hotel('d1')]);
    expect(lines.transportCosts).toHaveLength(2);
    expect(lines.entries).toHaveLength(1);
    expect(lines.entries[0].currency).toBe('USD');
  });
});
