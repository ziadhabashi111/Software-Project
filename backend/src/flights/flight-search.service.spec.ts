import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AirlinesService } from './airlines.service';
import type { AirportsService } from './airports.service';
import {
  FlightSortBy,
  SearchFlightsQueryDto,
  SortOrder,
} from './dto/search-flights.dto';
import { FlightSearchService } from './flight-search.service';
import { CabinClass, FlightStatus } from './flight-status';
import type { Flight } from './schemas/flight.schema';

const AIRLINE_ID = new Types.ObjectId();

const airports = [
  {
    iataCode: 'CAI',
    name: 'Cairo International Airport',
    cityId: 'cairo',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
  },
  {
    iataCode: 'JFK',
    name: 'John F. Kennedy International Airport',
    cityId: 'new_york',
    countryCode: 'US',
    timeZone: 'America/New_York',
  },
];

const flightRow = () => ({
  _id: new Types.ObjectId(),
  airlineId: AIRLINE_ID,
  flightNumber: 'MS985',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureUtc: new Date('2090-03-01T12:30:00Z'),
  arrivalUtc: new Date('2090-03-02T00:45:00Z'),
  departureLocalDate: '2090-03-01',
  status: FlightStatus.SCHEDULED,
  everBooked: false,
  fromPrice: 420,
  cabins: [
    {
      _id: new Types.ObjectId(),
      cabinClass: CabinClass.ECONOMY,
      totalSeats: 100,
      bookedSeats: 10,
      heldSeats: 2,
      price: 420,
      freeBags: 1,
      maxBagWeightKg: 23,
    },
  ],
});

function query(
  overrides: Partial<SearchFlightsQueryDto> = {},
): SearchFlightsQueryDto {
  return Object.assign(new SearchFlightsQueryDto(), {
    from: 'CAI',
    to: 'JFK',
    date: '2090-03-01',
    adults: 1,
    children: 0,
    infants: 0,
    sortBy: FlightSortBy.DEPARTURE,
    order: SortOrder.ASC,
    page: 1,
    limit: 10,
    ...overrides,
  });
}

function build(rows: ReturnType<typeof flightRow>[], airlineActive = true) {
  const airline = {
    id: AIRLINE_ID.toString(),
    name: 'EgyptAir',
    code: 'MS',
    isActive: airlineActive,
    baggagePolicy: { extraBagPrice: 25, maxExtraBags: 2 },
    cancellationPolicy: [{ daysBefore: 14, refundPercent: 100 }],
  };
  const model = {
    aggregate: jest
      .fn()
      .mockResolvedValue([
        { items: rows, total: rows.length ? [{ count: rows.length }] : [] },
      ]),
    hydrate: jest.fn((row: Record<string, unknown>) => ({
      ...row,
      id: String(row._id),
    })),
    findById: jest
      .fn()
      .mockResolvedValue(
        rows[0] ? { ...rows[0], id: String(rows[0]._id) } : null,
      ),
  };
  const airportsService = {
    findByCodes: jest.fn((codes: string[]) =>
      Promise.resolve(airports.filter((a) => codes.includes(a.iataCode))),
    ),
  };
  const airlinesService = {
    findActiveIds: jest.fn().mockResolvedValue([AIRLINE_ID]),
    findByIds: jest.fn().mockResolvedValue([airline]),
    findForFlights: jest.fn().mockResolvedValue(airline),
  };
  const service = new FlightSearchService(
    model as unknown as Model<Flight>,
    airportsService as unknown as AirportsService,
    airlinesService as unknown as AirlinesService,
  );
  return { service, model };
}

describe('FlightSearchService.search', () => {
  it('lists matching flights with local times and the from price', async () => {
    const { service } = build([flightRow()]);
    const result = await service.search(query());
    expect(result.message).toBeNull();
    expect(result.return).toBeNull();
    expect(result.outbound.total).toBe(1);
    const [item] = result.outbound.items;
    expect(item.fromPrice).toBe(420);
    expect(item.departure).toMatchObject({
      localDate: '2090-03-01',
      localTime: '14:30',
    });
    expect(item.cabins[0].seatsRemaining).toBe(88);
  });

  it('says "No flights found" when nothing matches', async () => {
    const { service } = build([]);
    const result = await service.search(query());
    expect(result.outbound.items).toEqual([]);
    expect(result.message).toBe('No flights found');
  });

  it('searches both directions for a round trip', async () => {
    const { service, model } = build([flightRow()]);
    const result = await service.search(query({ returnDate: '2090-03-10' }));
    expect(model.aggregate).toHaveBeenCalledTimes(2);
    expect(result.return?.total).toBe(1);
  });

  it('keeps the other criteria and rejects min price above max price', async () => {
    const { service, model } = build([]);
    await expect(
      service.search(query({ minPrice: 500, maxPrice: 100 })),
    ).rejects.toMatchObject({ status: 400 });
    expect(model.aggregate).not.toHaveBeenCalled();
  });

  it.each([
    ['no adult', { adults: 0 }],
    ['more infants than adults', { adults: 1, infants: 2 }],
    ['identical airports', { to: 'CAI' }],
    ['an airport outside the list', { to: 'ZZZ' }],
    ['a return before the departure', { returnDate: '2090-02-01' }],
  ])('rejects %s', async (_name, change) => {
    const { service } = build([flightRow()]);
    await expect(service.search(query(change))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('counts adults and children as seats, not infants', async () => {
    const { service, model } = build([flightRow()]);
    await service.search(query({ adults: 2, children: 1, infants: 1 }));
    const pipeline = JSON.stringify(
      (model.aggregate.mock.calls[0] as unknown[])[0],
    );
    expect(pipeline).toContain('"$$c.bookedSeats"');
    expect(pipeline).toMatch(/,3\]\}/);
  });
});

describe('FlightSearchService.details (FLT-17)', () => {
  it('returns the flight with the airline policies', async () => {
    const { service } = build([flightRow()]);
    const details = await service.details('f1');
    expect(details.cancellationPolicy).toEqual([
      { daysBefore: 14, refundPercent: 100 },
    ]);
    expect(details.baggagePolicy).toEqual({
      extraBagPrice: 25,
      maxExtraBags: 2,
    });
    expect(details.arrival).toMatchObject({
      localTime: '19:45',
      utcOffset: '-05:00',
    });
  });

  it('hides a deactivated airline’s flight from the public but not from its moderator or admins', async () => {
    const { service } = build([flightRow()], false);
    await expect(service.details('f1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.details('f1', { id: 'u', role: Role.USER }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.details('f1', { id: 'a', role: Role.ADMIN }),
    ).resolves.toMatchObject({ flightNumber: 'MS985' });
    await expect(
      service.details('f1', {
        id: 'm',
        role: Role.AIRLINE_MODERATOR,
        providerId: AIRLINE_ID.toString(),
      }),
    ).resolves.toMatchObject({ flightNumber: 'MS985' });
  });

  it('answers 404 for an unknown flight', async () => {
    const { service } = build([]);
    await expect(service.details('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
