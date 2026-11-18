import { BadRequestException } from '@nestjs/common';
import {
  ageOn,
  assertPassengerMix,
  PassengerType,
  passengerTypeFor,
  seatsNeeded,
} from './passenger-rules';

const day = new Date('2027-06-15T00:00:00Z');

describe('passenger types (FLT-12)', () => {
  it('uses the age on the day of travel', () => {
    expect(ageOn(new Date('2015-06-15'), day)).toBe(12);
    expect(ageOn(new Date('2015-06-16'), day)).toBe(11);
  });

  it('classifies adults 12+, children 2-11 and infants under 2', () => {
    expect(passengerTypeFor(new Date('2015-06-15'), day)).toBe(
      PassengerType.ADULT,
    );
    expect(passengerTypeFor(new Date('2015-06-16'), day)).toBe(
      PassengerType.CHILD,
    );
    expect(passengerTypeFor(new Date('2025-06-15'), day)).toBe(
      PassengerType.CHILD,
    );
    expect(passengerTypeFor(new Date('2025-06-16'), day)).toBe(
      PassengerType.INFANT,
    );
  });

  it('counts seats for adults and children only', () => {
    expect(seatsNeeded(2, 1)).toBe(3);
  });

  it('needs an adult and no more infants than adults', () => {
    expect(() => assertPassengerMix(1, 1)).not.toThrow();
    expect(() => assertPassengerMix(0, 0)).toThrow(BadRequestException);
    expect(() => assertPassengerMix(1, 2)).toThrow(BadRequestException);
  });
});
