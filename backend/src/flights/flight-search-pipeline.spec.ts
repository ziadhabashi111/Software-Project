import { Types } from 'mongoose';
import { FlightSortBy, SortOrder } from './dto/search-flights.dto';
import { buildSearchPipeline } from './flight-search-pipeline';
import type { FlightCriteria } from './flight-search-pipeline';
import { CabinClass } from './flight-status';

const airline = new Types.ObjectId();
const now = new Date('2027-01-01T00:00:00Z');

const criteria = (overrides: Partial<FlightCriteria> = {}): FlightCriteria => ({
  departureAirports: ['CAI'],
  arrivalAirports: ['JFK'],
  date: '2027-03-01',
  seats: 2,
  sortBy: FlightSortBy.DEPARTURE,
  order: SortOrder.ASC,
  skip: 0,
  limit: 10,
  now,
  activeAirlineIds: [airline],
  ...overrides,
});

type Stage = Record<string, unknown>;
const stages = (c: FlightCriteria): Stage[] =>
  buildSearchPipeline(c) as unknown as Stage[];

const cabinConditions = (c: FlightCriteria): unknown[] => {
  const addFields = stages(c)[1].$addFields as {
    cabins: { $filter: { cond: { $and: unknown[] } } };
  };
  return addFields.cabins.$filter.cond.$and;
};

describe('flight search pipeline (FLT-11, FLT-12, FLT-15)', () => {
  it('only matches Scheduled, future flights of active airlines on the local date', () => {
    const match = stages(criteria())[0].$match as Record<string, unknown>;
    expect(match).toMatchObject({
      status: 'Scheduled',
      departureAirport: { $in: ['CAI'] },
      arrivalAirport: { $in: ['JFK'] },
      departureLocalDate: '2027-03-01',
      departureUtc: { $gt: now },
      airlineId: { $in: [airline] },
    });
  });

  it('requires total - booked - held >= the seats needed in the cabin', () => {
    const [seats] = cabinConditions(criteria({ seats: 3 })) as {
      $gte: [unknown, number];
    }[];
    expect(seats.$gte[1]).toBe(3);
    expect(JSON.stringify(seats)).toContain('bookedSeats');
    expect(JSON.stringify(seats)).toContain('heldSeats');
  });

  it('adds the cabin class and the inclusive price range only when given', () => {
    expect(cabinConditions(criteria())).toHaveLength(1);
    const all = cabinConditions(
      criteria({
        cabinClass: CabinClass.BUSINESS,
        minPrice: 100,
        maxPrice: 500,
      }),
    );
    expect(all).toHaveLength(4);
    expect(JSON.stringify(all)).toContain('"$gte":["$$c.price",100]');
    expect(JSON.stringify(all)).toContain('"$lte":["$$c.price",500]');
    expect(JSON.stringify(all)).toContain('Business');
  });

  it('drops flights with no qualifying cabin', () => {
    expect(stages(criteria())[2]).toEqual({
      $match: { 'cabins.0': { $exists: true } },
    });
  });

  it.each([
    [FlightSortBy.PRICE, 'fromPrice'],
    [FlightSortBy.DURATION, 'durationMs'],
    [FlightSortBy.DEPARTURE, 'departureUtc'],
  ])('sorts by %s on %s, with a stable tie-break', (sortBy, field) => {
    const facet = stages(criteria({ sortBy, order: SortOrder.DESC }))[4]
      .$facet as {
      items: Stage[];
    };
    expect(facet.items[0]).toEqual({ $sort: { [field]: -1, _id: 1 } });
  });

  it('paginates', () => {
    const facet = stages(criteria({ skip: 20, limit: 10 }))[4].$facet as {
      items: Stage[];
    };
    expect(facet.items[1]).toEqual({ $skip: 20 });
    expect(facet.items[2]).toEqual({ $limit: 10 });
  });

  it('searches several airports at once for the itinerary flight search (ITN-26)', () => {
    const match = stages(criteria({ arrivalAirports: ['JFK', 'EWR'] }))[0]
      .$match as { arrivalAirport: unknown };
    expect(match.arrivalAirport).toEqual({ $in: ['JFK', 'EWR'] });
  });
});
