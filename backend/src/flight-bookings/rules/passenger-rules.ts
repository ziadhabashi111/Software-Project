import { fieldError } from '../../common/validation/validation-errors';
import {
  assertPassengerMix,
  PassengerType,
  passengerTypeFor,
} from '../../flights/passenger-rules';

/** Passengers per booking (my call; the sheet sets no limit). */
export const MAX_PASSENGERS = 9;

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

/**
 * FLT-12b / FLT-19: each passenger's declared type must match their date of
 * birth on the outbound's local departure date (Youssef's age rule, so search
 * and booking agree), then at least one adult and no more infants than
 * adults.
 */
export function classifyPassengers(
  passengers: { type: PassengerType; dateOfBirth: Date }[],
  travelLocalDate: string,
  today: Date,
): PassengerCounts {
  if (passengers.length > MAX_PASSENGERS) {
    throw fieldError(
      'passengers',
      `A booking can have at most ${MAX_PASSENGERS} passengers`,
    );
  }
  const travelDate = new Date(`${travelLocalDate}T00:00:00Z`);
  const counts: PassengerCounts = { adults: 0, children: 0, infants: 0 };

  passengers.forEach((passenger, i) => {
    if (passenger.dateOfBirth.getTime() > today.getTime()) {
      throw fieldError(
        `passengers.${i}.dateOfBirth`,
        'Date of birth cannot be in the future',
      );
    }
    const actual = passengerTypeFor(passenger.dateOfBirth, travelDate);
    if (actual !== passenger.type) {
      throw fieldError(
        `passengers.${i}.type`,
        `This passenger is ${article(actual)} ${actual} on the travel date (adult 12+, child 2-11, infant under 2)`,
      );
    }
    if (actual === PassengerType.ADULT) counts.adults += 1;
    else if (actual === PassengerType.CHILD) counts.children += 1;
    else counts.infants += 1;
  });

  assertPassengerMix(counts.adults, counts.infants);
  return counts;
}

function article(type: PassengerType): string {
  return type === PassengerType.ADULT || type === PassengerType.INFANT
    ? 'an'
    : 'a';
}
