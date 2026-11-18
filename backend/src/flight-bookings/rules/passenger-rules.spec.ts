import { HttpException } from '@nestjs/common';
import { PassengerType } from '../../flights/passenger-rules';
import { classifyPassengers, MAX_PASSENGERS } from './passenger-rules';

const TODAY = new Date('2026-11-18T10:00:00Z');

function errorField(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    const body = (error as HttpException).getResponse() as {
      errors?: { field: string }[];
    };
    return body.errors?.[0]?.field;
  }
  return undefined;
}

const p = (type: PassengerType, dob: string) => ({
  type,
  dateOfBirth: new Date(`${dob}T00:00:00Z`),
});

describe('classifyPassengers (FLT-12, FLT-19)', () => {
  it('counts an adult on the 12th birthday', () => {
    expect(
      classifyPassengers(
        [p(PassengerType.ADULT, '2015-03-10')],
        '2027-03-10',
        TODAY,
      ),
    ).toEqual({ adults: 1, children: 0, infants: 0 });
  });

  it('counts a child the day before the 12th birthday', () => {
    const counts = classifyPassengers(
      [
        p(PassengerType.ADULT, '1990-01-01'),
        p(PassengerType.CHILD, '2015-03-11'),
      ],
      '2027-03-10',
      TODAY,
    );
    expect(counts).toEqual({ adults: 1, children: 1, infants: 0 });
  });

  it('counts an infant the day before the 2nd birthday', () => {
    const counts = classifyPassengers(
      [
        p(PassengerType.ADULT, '1990-01-01'),
        p(PassengerType.INFANT, '2025-03-11'),
      ],
      '2027-03-10',
      TODAY,
    );
    expect(counts.infants).toBe(1);
  });

  it('classifies on the local departure date, not the UTC date', () => {
    // 2nd birthday is the local departure date (the UTC date may still be the 9th).
    const counts = classifyPassengers(
      [
        p(PassengerType.ADULT, '1990-01-01'),
        p(PassengerType.CHILD, '2025-03-10'),
      ],
      '2027-03-10',
      TODAY,
    );
    expect(counts.children).toBe(1);
  });

  it('rejects a declared type that does not match the date of birth', () => {
    expect(
      errorField(() =>
        classifyPassengers(
          [p(PassengerType.ADULT, '2026-01-01')],
          '2027-03-10',
          TODAY,
        ),
      ),
    ).toBe('passengers.0.type');
  });

  it('rejects a date of birth in the future', () => {
    expect(
      errorField(() =>
        classifyPassengers(
          [p(PassengerType.INFANT, '2026-12-01')],
          '2027-03-10',
          TODAY,
        ),
      ),
    ).toBe('passengers.0.dateOfBirth');
  });

  it(`allows at most ${MAX_PASSENGERS} passengers`, () => {
    const many = Array.from({ length: MAX_PASSENGERS + 1 }, () =>
      p(PassengerType.ADULT, '1990-01-01'),
    );
    expect(
      errorField(() => classifyPassengers(many, '2027-03-10', TODAY)),
    ).toBe('passengers');
  });

  it('needs no more infants than adults', () => {
    expect(
      errorField(() =>
        classifyPassengers(
          [
            p(PassengerType.ADULT, '1990-01-01'),
            p(PassengerType.INFANT, '2026-01-01'),
            p(PassengerType.INFANT, '2026-02-01'),
          ],
          '2027-03-10',
          TODAY,
        ),
      ),
    ).toBe('infants');
  });

  it('needs at least one adult', () => {
    expect(
      errorField(() =>
        classifyPassengers(
          [p(PassengerType.CHILD, '2020-01-01')],
          '2027-03-10',
          TODAY,
        ),
      ),
    ).toBe('adults');
  });
});
