import { HttpException } from '@nestjs/common';
import { FlightStatus } from '../../flights/flight-status';
import { assertBookable, assertReturnMatches } from './itinerary-rules';

const NOW = new Date('2026-11-18T10:00:00Z');
const LATER = new Date('2026-12-01T10:00:00Z');

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

const flight = (
  overrides: Partial<Parameters<typeof assertBookable>[0]> = {},
) => ({
  status: FlightStatus.SCHEDULED,
  departureUtc: LATER,
  cabins: [{ cabinClass: 'Economy' }],
  ...overrides,
});

describe('assertBookable (FLT-22, ACC-15)', () => {
  it('accepts a scheduled future flight of an active airline', () => {
    expect(() =>
      assertBookable(flight(), { isActive: true }, 'Economy', 'outbound', NOW),
    ).not.toThrow();
  });

  it('rejects a cancelled flight', () => {
    expect(
      errorField(() =>
        assertBookable(
          flight({ status: FlightStatus.CANCELLED }),
          { isActive: true },
          'Economy',
          'outbound',
          NOW,
        ),
      ),
    ).toBe('outbound.flightId');
  });

  it('rejects a departed flight even before the status job runs', () => {
    expect(
      errorField(() =>
        assertBookable(
          flight({ departureUtc: new Date('2026-11-18T09:59:00Z') }),
          { isActive: true },
          'Economy',
          'outbound',
          NOW,
        ),
      ),
    ).toBe('outbound.flightId');
  });

  it('rejects a flight of a deactivated airline', () => {
    expect(
      errorField(() =>
        assertBookable(flight(), { isActive: false }, 'Economy', 'return', NOW),
      ),
    ).toBe('return.flightId');
  });

  it('rejects a cabin class the flight does not have', () => {
    expect(
      errorField(() =>
        assertBookable(flight(), { isActive: true }, 'First', 'outbound', NOW),
      ),
    ).toBe('outbound.cabinClass');
  });
});

describe('assertReturnMatches (FLT-12a)', () => {
  const outbound = {
    id: 'a',
    departureAirport: 'CAI',
    arrivalAirport: 'DXB',
    arrivalUtc: new Date('2026-12-01T14:00:00Z'),
  };
  const ret = (
    overrides: Partial<Parameters<typeof assertReturnMatches>[1]> = {},
  ) => ({
    id: 'b',
    departureAirport: 'DXB',
    arrivalAirport: 'CAI',
    departureUtc: new Date('2026-12-05T10:00:00Z'),
    ...overrides,
  });

  it('accepts the reverse route after the outbound lands', () => {
    expect(() => assertReturnMatches(outbound, ret())).not.toThrow();
  });

  it('rejects the same flight twice', () => {
    expect(
      errorField(() => assertReturnMatches(outbound, ret({ id: 'a' }))),
    ).toBe('return.flightId');
  });

  it('rejects a return that is not the reverse route', () => {
    expect(
      errorField(() =>
        assertReturnMatches(
          outbound,
          ret({ departureAirport: 'CAI', arrivalAirport: 'DXB' }),
        ),
      ),
    ).toBe('return.flightId');
  });

  const cities: Record<string, string> = {
    CAI: 'cairo',
    SPX: 'cairo',
    DXB: 'dubai',
    DWC: 'dubai',
    AUH: 'abu-dhabi',
  };
  const cityOf = (code: string) => cities[code];

  it('accepts a return from another airport of the same cities (ITN-26 searches any airport in the city)', () => {
    expect(() =>
      assertReturnMatches(
        outbound,
        ret({ departureAirport: 'DWC', arrivalAirport: 'SPX' }),
        cityOf,
      ),
    ).not.toThrow();
  });

  it('rejects a return from another city', () => {
    expect(
      errorField(() =>
        assertReturnMatches(
          outbound,
          ret({ departureAirport: 'AUH', arrivalAirport: 'CAI' }),
          cityOf,
        ),
      ),
    ).toBe('return.flightId');
  });

  it('rejects a return from another airport when the cities are unknown', () => {
    expect(
      errorField(() =>
        assertReturnMatches(
          outbound,
          ret({ departureAirport: 'DWC' }),
          () => undefined,
        ),
      ),
    ).toBe('return.flightId');
  });

  it('rejects a return that leaves before the outbound lands', () => {
    expect(
      errorField(() =>
        assertReturnMatches(
          outbound,
          ret({ departureUtc: new Date('2026-12-01T13:00:00Z') }),
        ),
      ),
    ).toBe('return.flightId');
  });
});
