import { fieldError } from '../common/validation/validation-errors';

/** FLT-12: adults 12+, children 2-11, infants under 2. */
export enum PassengerType {
  ADULT = 'adult',
  CHILD = 'child',
  INFANT = 'infant',
}

export const ADULT_MIN_AGE = 12;
export const CHILD_MIN_AGE = 2;
/** Infants pay 10% of the fare and occupy no seat (FLT-12). */
export const INFANT_FARE_SHARE = 0.1;

/** Whole years between a birth date and a date (the flight's departure date). */
export function ageOn(birthDate: Date, onDate: Date): number {
  let age = onDate.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = onDate.getUTCMonth() - birthDate.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && onDate.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

/** Passenger type implied by a date of birth on the day of travel (FLT-12, FLT-19). */
export function passengerTypeFor(birthDate: Date, onDate: Date): PassengerType {
  const age = ageOn(birthDate, onDate);
  if (age >= ADULT_MIN_AGE) return PassengerType.ADULT;
  if (age >= CHILD_MIN_AGE) return PassengerType.CHILD;
  return PassengerType.INFANT;
}

/** Seats needed: adults and children occupy a seat, infants do not (FLT-12). */
export function seatsNeeded(adults: number, children: number): number {
  return adults + children;
}

/** FLT-12: at least one adult and no more infants than adults. */
export function assertPassengerMix(adults: number, infants: number): void {
  if (adults < 1) {
    throw fieldError('adults', 'At least one adult is required');
  }
  if (infants > adults) {
    throw fieldError('infants', 'There cannot be more infants than adults');
  }
}
