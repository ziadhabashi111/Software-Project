import { fieldError } from '../../common/validation/validation-errors';
import { effectiveStatus, FlightStatus } from '../../flights/flight-status';

export type SegmentField = 'outbound' | 'return';

/**
 * FLT-22 / ACC-15: only a Scheduled flight that has not departed, of an
 * active airline, with the requested cabin class, can be booked. Departure is
 * checked against the clock, not only the stored status (the Departed job
 * runs once a minute).
 */
export function assertBookable(
  flight: {
    status: FlightStatus;
    departureUtc: Date;
    cabins: { cabinClass: string }[];
  },
  airline: { isActive: boolean } | null,
  cabinClass: string,
  field: SegmentField,
  now: Date,
): void {
  const status = effectiveStatus(flight, now);
  if (status !== FlightStatus.SCHEDULED) {
    throw fieldError(
      `${field}.flightId`,
      `This flight cannot be booked (it is ${status})`,
    );
  }
  if (!airline?.isActive) {
    throw fieldError(
      `${field}.flightId`,
      'This airline is not accepting bookings',
    );
  }
  if (!flight.cabins.some((cabin) => cabin.cabinClass === cabinClass)) {
    throw fieldError(
      `${field}.cabinClass`,
      `This flight has no ${cabinClass} cabin`,
    );
  }
}

/**
 * FLT-12a: the return flight flies the outbound route in reverse, city to
 * city, and leaves after the outbound has landed. "City to city" because an
 * itinerary searches any airport in the destination city (ITN-26): out to
 * DXB and back from DWC is the same trip. `cityOf` gives an airport's city;
 * an airport with no known city only matches itself.
 */
export function assertReturnMatches(
  outbound: {
    id: string;
    departureAirport: string;
    arrivalAirport: string;
    arrivalUtc: Date;
  },
  ret: {
    id: string;
    departureAirport: string;
    arrivalAirport: string;
    departureUtc: Date;
  },
  cityOf: (iataCode: string) => string | undefined = () => undefined,
): void {
  if (outbound.id === ret.id) {
    throw fieldError(
      'return.flightId',
      'The return flight must be a different flight',
    );
  }
  const place = (code: string) => cityOf(code) ?? `airport:${code}`;
  if (
    place(ret.departureAirport) !== place(outbound.arrivalAirport) ||
    place(ret.arrivalAirport) !== place(outbound.departureAirport)
  ) {
    throw fieldError(
      'return.flightId',
      `The return flight must fly ${outbound.arrivalAirport} to ${outbound.departureAirport} (or between other airports of those two cities)`,
    );
  }
  if (ret.departureUtc.getTime() <= outbound.arrivalUtc.getTime()) {
    throw fieldError(
      'return.flightId',
      'The return flight must leave after the outbound flight lands',
    );
  }
}
