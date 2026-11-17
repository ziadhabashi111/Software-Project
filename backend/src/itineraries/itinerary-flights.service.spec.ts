import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import type { AirportsService } from '../flights/airports.service';
import { FlightSortBy, SortOrder } from '../flights/dto/search-flights.dto';
import type { FlightSearchService } from '../flights/flight-search.service';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import { ItineraryFlightsService } from './itinerary-flights.service';
import type { ItineraryRepository } from './itinerary.repository';

/** Arguments of one recorded call to a jest mock. */
const argsOf = (mock: jest.Mock, call = 0): unknown[] =>
  mock.mock.calls[call] as unknown[];

const owner: AuthUser = { id: 'owner1', role: Role.USER };
const stranger: AuthUser = { id: 'owner2', role: Role.USER };

const itinerary = (dayCount = 3, city = 'paris') => ({
  startDate: new Date('2027-03-01T00:00:00Z'),
  days: Array.from({ length: dayCount }, (_, i) => ({
    _id: new Types.ObjectId(),
    city: i === 0 ? city : 'lyon',
  })),
});

const emptyPage = { items: [], total: 0, page: 1, limit: 10 };

function query(
  overrides: Partial<ItineraryFlightsQueryDto> = {},
): ItineraryFlightsQueryDto {
  return Object.assign(new ItineraryFlightsQueryDto(), {
    from: 'CAI',
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

function build(doc = itinerary(), cityAirports = ['CDG', 'ORY']) {
  const repository = {
    loadOwned: jest
      .fn()
      .mockImplementation((_id: string, user: AuthUser) =>
        user.id === owner.id
          ? Promise.resolve(doc)
          : Promise.reject(new NotFoundException('Itinerary not found')),
      ),
  };
  const airports = {
    findByCity: jest
      .fn()
      .mockResolvedValue(cityAirports.map((iataCode) => ({ iataCode }))),
  };
  const flights = {
    requireListed: jest.fn().mockResolvedValue(undefined),
    searchRoutes: jest.fn().mockResolvedValue({
      outbound: emptyPage,
      return: null,
      message: 'No flights found',
    }),
  };
  const service = new ItineraryFlightsService(
    repository as unknown as ItineraryRepository,
    airports as unknown as AirportsService,
    flights as unknown as FlightSearchService,
  );
  return { service, airports, flights };
}

describe('ItineraryFlightsService (ITN-26)', () => {
  it('searches from the origin to every airport in the first day’s city, on the start date', async () => {
    const { service, airports, flights } = build();
    const result = await service.search(owner, 'it1', query());
    expect(airports.findByCity).toHaveBeenCalledWith('paris');
    const params = argsOf(flights.searchRoutes)[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      departureAirports: ['CAI'],
      arrivalAirports: ['CDG', 'ORY'],
      date: '2027-03-01',
    });
    expect(params.returnDate).toBeUndefined();
    expect(result.searched).toEqual({
      originAirport: 'CAI',
      destinationCity: 'paris',
      destinationAirports: ['CDG', 'ORY'],
      date: '2027-03-01',
      returnDate: null,
    });
  });

  it('defaults the return date of a round trip to the last day’s date', async () => {
    const { service, flights } = build(itinerary(5));
    const result = await service.search(
      owner,
      'it1',
      query({ roundTrip: true }),
    );
    expect(
      (argsOf(flights.searchRoutes)[0] as { returnDate: string }).returnDate,
    ).toBe('2027-03-05');
    expect(result.searched.returnDate).toBe('2027-03-05');
  });

  it('keeps explicit dates', async () => {
    const { service, flights } = build();
    await service.search(
      owner,
      'it1',
      query({ date: '2027-02-27', returnDate: '2027-03-09' }),
    );
    expect(argsOf(flights.searchRoutes)[0]).toMatchObject({
      date: '2027-02-27',
      returnDate: '2027-03-09',
    });
  });

  it('hands passengers and filters to the shared flight search', async () => {
    const { service, flights } = build();
    await service.search(
      owner,
      'it1',
      query({
        adults: 2,
        children: 1,
        infants: 1,
        minPrice: 100,
        maxPrice: 900,
      }),
    );
    expect(argsOf(flights.searchRoutes)[0]).toMatchObject({
      adults: 2,
      children: 1,
      infants: 1,
      minPrice: 100,
      maxPrice: 900,
    });
  });

  it('is owner only: someone else’s itinerary is a 404 and nothing is searched', async () => {
    const { service, flights } = build();
    await expect(
      service.search(stranger, 'it1', query()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(flights.searchRoutes).not.toHaveBeenCalled();
  });

  it('needs at least one day', async () => {
    const { service } = build(itinerary(0));
    await expect(service.search(owner, 'it1', query())).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects an origin that is not in the airport list', async () => {
    const { service, flights } = build();
    flights.requireListed.mockRejectedValueOnce(
      Object.assign(new Error('not listed'), { status: 400 }),
    );
    await expect(
      service.search(owner, 'it1', query({ from: 'ZZZ' })),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(flights.searchRoutes).not.toHaveBeenCalled();
  });

  it('rejects an origin that is already in the destination city', async () => {
    const { service, flights } = build();
    await expect(
      service.search(owner, 'it1', query({ from: 'CDG' })),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(flights.searchRoutes).not.toHaveBeenCalled();
  });

  it('answers with an empty result and a message when the city has no airport', async () => {
    const { service, flights } = build(itinerary(2, 'lyon'), []);
    const result = await service.search(
      owner,
      'it1',
      query({ roundTrip: true }),
    );
    expect(flights.searchRoutes).not.toHaveBeenCalled();
    expect(result.message).toContain('lyon');
    expect(result.outbound.total).toBe(0);
    expect(result.return?.total).toBe(0);
  });
});
