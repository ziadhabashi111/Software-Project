import { fieldError } from '../common/validation/validation-errors';

/** FLT-03: a flight must connect two different listed airports. */
export function assertDifferentAirports(
  departureAirport: string,
  arrivalAirport: string,
): void {
  if (departureAirport === arrivalAirport) {
    throw fieldError(
      'arrivalAirport',
      'Departure and arrival airports must be different',
    );
  }
}

/**
 * FLT-03: the arrival must be after the departure (compared in UTC) and the
 * departure must not be in the past.
 */
export function assertValidSchedule(
  departureUtc: Date,
  arrivalUtc: Date,
  now: Date = new Date(),
): void {
  if (departureUtc.getTime() <= now.getTime()) {
    throw fieldError('departureTime', 'Departure cannot be in the past');
  }
  if (arrivalUtc.getTime() <= departureUtc.getTime()) {
    throw fieldError('arrivalTime', 'Arrival must be after departure');
  }
}

/** Seats a passenger can still book in a cabin. */
export function seatsRemaining(cabin: {
  totalSeats: number;
  bookedSeats: number;
  heldSeats: number;
}): number {
  return Math.max(0, cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats);
}
