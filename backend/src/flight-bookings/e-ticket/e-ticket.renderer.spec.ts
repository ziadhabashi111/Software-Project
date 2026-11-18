import { BookingStatus } from '../../common/booking-status/booking-status';
import { CabinClass } from '../../flights/flight-status';
import { PassengerType } from '../../flights/passenger-rules';
import type { FlightBookingView } from '../flight-booking-view';
import { renderETicket } from './e-ticket.renderer';

const end = (code: string, time: string) => ({
  airport: {
    iataCode: code,
    name: `${code} Airport`,
    cityId: 'x',
    timeZone: 'Africa/Cairo',
  },
  utc: '2027-01-10T08:00:00.000Z',
  localDate: '2027-01-10',
  localTime: time,
  utcOffset: '+02:00',
});

const view: FlightBookingView = {
  id: 'b1',
  reference: 'FB-7KQ2M9XA',
  status: BookingStatus.CONFIRMED,
  statusLabel: 'Confirmed',
  tripType: 'one-way',
  segments: [
    {
      flightId: 'f1',
      flightNumber: 'NA101',
      airline: { id: 'a1', name: 'Nile Air', code: 'NA' },
      cabinClass: CabinClass.ECONOMY,
      departure: end('CAI', '10:00'),
      arrival: end('DXB', '14:30'),
      durationMinutes: 210,
      flightStatus: 'Scheduled',
      farePerSeat: 200,
      freeBags: 1,
      maxBagWeightKg: 23,
      extraBagPrice: 30,
    },
  ],
  passengers: [
    {
      fullName: 'Mona Adel',
      dateOfBirth: '1990-05-01',
      documentNumber: 'A1234567',
      type: PassengerType.ADULT,
      extraBags: 1,
      extraBagWeightKg: 20,
      fare: 200,
      baggageFee: 30,
    },
  ],
  seats: 1,
  price: { fares: 200, baggage: 30, total: 230, perSegment: [230] },
  currency: 'USD',
  policies: { cancellationTiers: [], baggagePolicy: null },
  holdExpiresAt: null,
  confirmedAt: '2026-11-18T10:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  payment: null,
  refund: null,
  createdAt: '2026-11-18T09:55:00.000Z',
};

describe('renderETicket (FLT-23, GEN-06)', () => {
  it('produces a PDF document', async () => {
    const pdf = await renderETicket(view);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
