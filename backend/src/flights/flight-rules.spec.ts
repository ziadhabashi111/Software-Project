import { BadRequestException } from '@nestjs/common';
import {
  assertDifferentAirports,
  assertValidSchedule,
  seatsRemaining,
} from './flight-rules';
import { effectiveStatus, FlightStatus } from './flight-status';

function failingField(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      errors: { field: string }[];
    };
    return body.errors[0].field;
  }
  return undefined;
}

const now = new Date('2027-01-01T00:00:00Z');

describe('flight rules (FLT-03)', () => {
  it('rejects identical airports', () => {
    expect(failingField(() => assertDifferentAirports('CAI', 'CAI'))).toBe(
      'arrivalAirport',
    );
    expect(() => assertDifferentAirports('CAI', 'JFK')).not.toThrow();
  });

  it('rejects a departure in the past, including right now', () => {
    expect(
      failingField(() =>
        assertValidSchedule(
          new Date('2026-12-31T23:59:00Z'),
          new Date('2027-01-01T05:00:00Z'),
          now,
        ),
      ),
    ).toBe('departureTime');
    expect(
      failingField(() =>
        assertValidSchedule(now, new Date('2027-01-01T05:00:00Z'), now),
      ),
    ).toBe('departureTime');
  });

  it('rejects an arrival that is not after the departure, compared in UTC', () => {
    const departure = new Date('2027-02-01T10:00:00Z');
    expect(
      failingField(() => assertValidSchedule(departure, departure, now)),
    ).toBe('arrivalTime');
    expect(
      failingField(() =>
        assertValidSchedule(departure, new Date('2027-02-01T09:00:00Z'), now),
      ),
    ).toBe('arrivalTime');
    expect(() =>
      assertValidSchedule(departure, new Date('2027-02-01T10:01:00Z'), now),
    ).not.toThrow();
  });
});

describe('seats and status (FLT-04, FLT-30)', () => {
  it('counts seats remaining as total - booked - held, never below 0', () => {
    expect(
      seatsRemaining({ totalSeats: 100, bookedSeats: 30, heldSeats: 5 }),
    ).toBe(65);
    expect(
      seatsRemaining({ totalSeats: 10, bookedSeats: 8, heldSeats: 5 }),
    ).toBe(0);
  });

  it('turns Scheduled into Departed once the departure time has passed', () => {
    const flight = {
      status: FlightStatus.SCHEDULED,
      departureUtc: new Date('2027-01-01T10:00:00Z'),
    };
    expect(effectiveStatus(flight, new Date('2027-01-01T09:59:00Z'))).toBe(
      FlightStatus.SCHEDULED,
    );
    expect(effectiveStatus(flight, new Date('2027-01-01T10:00:00Z'))).toBe(
      FlightStatus.DEPARTED,
    );
  });

  it('never revives a Cancelled flight', () => {
    expect(
      effectiveStatus(
        {
          status: FlightStatus.CANCELLED,
          departureUtc: new Date('2020-01-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(FlightStatus.CANCELLED);
  });
});
