import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../auth/auth.types';
import { SortOrder } from '../../flights/dto/search-flights.dto';
import type { HotelRatings } from '../../hotel-bookings/hotel-ratings';
import type { HotelReservationQueries } from '../../hotel-bookings/hotel-reservation-queries';
import { HotelSearchHook } from '../../itineraries/hotel-search';
import type { Hotel } from '../schemas/hotel.schema';
import type { Room } from '../schemas/room.schema';
import { HotelSortBy } from './hotel-search-rules';
import { HotelSearchService } from './hotel-search.service';
import type { HotelSearchQuery } from './hotel-search.service';

const NOW = new Date('2027-01-01T10:00:00.000Z');
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const WHOLE_MARCH = [{ from: day('2027-03-01'), to: day('2027-03-31') }];

const query: HotelSearchQuery = {
  city: 'cairo',
  checkIn: '2027-03-10',
  checkOut: '2027-03-13',
  guests: 2,
  rooms: 1,
  page: 1,
  limit: 10,
};

function hotelDoc(name: string, overrides: Record<string, unknown> = {}) {
  const id = new Types.ObjectId();
  return {
    id: id.toString(),
    name,
    address: `${name} street`,
    city: 'cairo',
    country: 'EG',
    starClass: 4,
    amenities: ['wifi'],
    photos: [{ _id: new Types.ObjectId(), url: `/uploads/${name}.jpg` }],
    isActive: true,
    ...overrides,
  };
}

function roomDoc(
  hotelId: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: new Types.ObjectId().toString(),
    hotel: new Types.ObjectId(hotelId),
    name,
    type: 'Double',
    beds: 2,
    maxOccupancy: 2,
    pricePerNight: 100,
    isActive: true,
    availability: WHOLE_MARCH,
    blocked: [],
    ...overrides,
  };
}

function build(options: {
  hotels?: ReturnType<typeof hotelDoc>[];
  rooms?: ReturnType<typeof roomDoc>[];
  taken?: string[];
  ratings?: Record<string, number | null>;
  single?: ReturnType<typeof hotelDoc> | null;
}) {
  const hotels = {
    find: jest.fn().mockResolvedValue(options.hotels ?? []),
    findById: jest.fn().mockResolvedValue(options.single ?? null),
  };
  const rooms = { find: jest.fn().mockResolvedValue(options.rooms ?? []) };
  const queries = {
    takenRoomIds: jest.fn().mockResolvedValue(new Set(options.taken ?? [])),
  };
  const ratings = {
    forHotels: jest.fn().mockImplementation((ids: string[]) =>
      Promise.resolve(
        new Map(
          ids.map((id) => {
            const average = options.ratings?.[id] ?? null;
            return [
              id,
              {
                averageRating: average,
                ratingCount: average === null ? 0 : 3,
              },
            ];
          }),
        ),
      ),
    ),
  };
  const hook = new HotelSearchHook();
  const service = new HotelSearchService(
    hotels as unknown as Model<Hotel>,
    rooms as unknown as Model<Room>,
    queries as unknown as HotelReservationQueries,
    ratings as unknown as HotelRatings,
    hook,
  );
  return { service, hotels, rooms, queries, hook };
}

describe('HotelSearchService.search (HTL-11, HTL-12)', () => {
  it('registers itself as the hotel search for itineraries', () => {
    const { service, hook } = build({});
    service.onModuleInit();
    expect(hook.get()).toBe(service);
  });

  it('lists an active hotel with a free room, priced by its cheapest free room', async () => {
    const nile = hotelDoc('Nile');
    const { service } = build({
      hotels: [nile],
      rooms: [
        roomDoc(nile.id, '101', { pricePerNight: 150 }),
        roomDoc(nile.id, '102', { pricePerNight: 90 }),
      ],
      ratings: { [nile.id]: 4.5 },
    });
    const page = await service.search(query, NOW);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: nile.id,
      name: 'Nile',
      city: 'cairo',
      starClass: 4,
      photo: '/uploads/Nile.jpg',
      pricePerNight: 90,
      freeRooms: 2,
      rating: { averageRating: 4.5, ratingCount: 3 },
    });
  });

  it('only asks for active hotels of the chosen city and/or country', async () => {
    const { service, hotels } = build({});
    await service.search({ ...query, city: undefined, country: 'EG' }, NOW);
    expect(hotels.find).toHaveBeenLastCalledWith({
      isActive: true,
      country: 'EG',
    });
    await service.search({ ...query, country: 'EG' }, NOW);
    expect(hotels.find).toHaveBeenLastCalledWith({
      isActive: true,
      city: 'cairo',
      country: 'EG',
    });
  });

  // A room held by an unpaid, unexpired hold is not free (HTL-11 "free for the whole stay").
  it('leaves out a hotel whose only room is taken by a reservation or hold', async () => {
    const nile = hotelDoc('Nile');
    const room = roomDoc(nile.id, '101');
    const { service, queries } = build({
      hotels: [nile],
      rooms: [room],
      taken: [room.id],
    });
    const page = await service.search(query, NOW);
    expect(page.items).toEqual([]);
    expect(queries.takenRoomIds).toHaveBeenCalledWith(
      [room.id],
      day('2027-03-10'),
      day('2027-03-13'),
      NOW,
    );
  });

  it('needs enough free rooms whose combined occupancy covers the guests', async () => {
    const nile = hotelDoc('Nile');
    const small = hotelDoc('Small');
    const { service } = build({
      hotels: [nile, small],
      rooms: [
        roomDoc(nile.id, '1', { maxOccupancy: 2 }),
        roomDoc(nile.id, '2', { maxOccupancy: 2 }),
        roomDoc(small.id, '1', { maxOccupancy: 2 }),
      ],
    });
    const page = await service.search({ ...query, guests: 4, rooms: 2 }, NOW);
    expect(page.items.map((h) => h.name)).toEqual(['Nile']);
  });

  it('skips deactivated, blocked and unavailable rooms', async () => {
    const nile = hotelDoc('Nile');
    const { service } = build({
      hotels: [nile],
      rooms: [
        roomDoc(nile.id, 'off', { isActive: false }),
        roomDoc(nile.id, 'blocked', {
          blocked: [{ from: day('2027-03-11'), to: day('2027-03-11') }],
        }),
        roomDoc(nile.id, 'later', {
          availability: [{ from: day('2027-04-01'), to: day('2027-04-30') }],
        }),
      ],
    });
    expect((await service.search(query, NOW)).items).toEqual([]);
  });

  it('filters by price and rating, and sorts the rest', async () => {
    const a = hotelDoc('A');
    const b = hotelDoc('B');
    const c = hotelDoc('C');
    const d = hotelDoc('D');
    const { service } = build({
      hotels: [a, b, c, d],
      rooms: [
        roomDoc(a.id, '1', { pricePerNight: 80 }),
        roomDoc(b.id, '1', { pricePerNight: 120 }),
        roomDoc(c.id, '1', { pricePerNight: 100 }),
        roomDoc(d.id, '1', { pricePerNight: 100 }),
      ],
      ratings: { [a.id]: 3, [b.id]: 4.8, [c.id]: 4.2 }, // D is unrated
    });
    const rated = await service.search(
      {
        ...query,
        minRating: 4,
        sortBy: HotelSortBy.RATING,
        order: SortOrder.DESC,
      },
      NOW,
    );
    // D is unrated and A is below 4, so both are excluded.
    expect(rated.items.map((h) => h.name)).toEqual(['B', 'C']);

    const priced = await service.search(
      { ...query, minPrice: 100, maxPrice: 120 },
      NOW,
    );
    expect(priced.items.map((h) => h.name)).toEqual(['C', 'D', 'B']);
  });

  it('pages the results and reports the total across pages', async () => {
    const hotels = ['A', 'B', 'C'].map((n) => hotelDoc(n));
    const { service } = build({
      hotels,
      rooms: hotels.map((h, i) =>
        roomDoc(h.id, '1', { pricePerNight: 100 + i }),
      ),
    });
    const page2 = await service.search({ ...query, page: 2, limit: 2 }, NOW);
    expect(page2).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(page2.items.map((h) => h.name)).toEqual(['C']);
  });

  it('answers an empty page, without reading rooms, when no hotel matches the place', async () => {
    const { service, rooms } = build({ hotels: [] });
    const page = await service.search(query, NOW);
    expect(page).toEqual({ items: [], total: 0, page: 1, limit: 10 });
    expect(rooms.find).not.toHaveBeenCalled();
  });

  describe('validation', () => {
    const cases: [string, Partial<HotelSearchQuery>, string][] = [
      ['no city or country', { city: undefined }, 'city'],
      ['check-out not after check-in', { checkOut: '2027-03-10' }, 'checkOut'],
      ['check-in in the past', { checkIn: '2026-12-31' }, 'checkIn'],
      ['an impossible date', { checkIn: '2027-02-30' }, 'checkIn'],
      ['more rooms than guests', { guests: 1, rooms: 2 }, 'rooms'],
      [
        'a minimum price above the maximum',
        { minPrice: 9, maxPrice: 3 },
        'minPrice',
      ],
      ['a stay of more than 30 nights', { checkOut: '2027-04-20' }, 'checkOut'],
    ];

    // Each rule must reject before any database work is done.
    it.each(cases)('rejects %s', async (_label, change, field) => {
      const { service, hotels } = build({});
      const error = await service
        .search({ ...query, ...change }, NOW)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).toContain(field);
      expect(hotels.find).not.toHaveBeenCalled();
    });

    it('accepts check-in today', async () => {
      const { service } = build({});
      await expect(
        service.search(
          { ...query, checkIn: '2027-01-01', checkOut: '2027-01-03' },
          NOW,
        ),
      ).resolves.toMatchObject({ total: 0 });
    });
  });
});

describe('HotelSearchService.availableRooms (HTL-15)', () => {
  const stay = { checkIn: '2027-03-10', checkOut: '2027-03-13' };

  it('lists the free rooms with price per night and the total stay price', async () => {
    const nile = hotelDoc('Nile');
    const { service } = build({
      single: nile,
      rooms: [
        roomDoc(nile.id, '102', { pricePerNight: 150.5, beds: 3 }),
        roomDoc(nile.id, '101', { pricePerNight: 80 }),
      ],
    });
    const view = await service.availableRooms(nile.id, stay, undefined, NOW);
    expect(view).toMatchObject({
      hotelId: nile.id,
      checkIn: '2027-03-10',
      checkOut: '2027-03-13',
      nights: 3,
    });
    // Cheapest first; 3 nights: 80 x 3 and 150.5 x 3.
    expect(
      view.rooms.map((r) => [r.name, r.pricePerNight, r.totalPrice]),
    ).toEqual([
      ['101', 80, 240],
      ['102', 150.5, 451.5],
    ]);
    expect(view.rooms[1]).toMatchObject({
      type: 'Double',
      beds: 3,
      maxOccupancy: 2,
    });
  });

  it('leaves out taken, blocked and deactivated rooms', async () => {
    const nile = hotelDoc('Nile');
    const taken = roomDoc(nile.id, 'taken');
    const { service } = build({
      single: nile,
      taken: [taken.id],
      rooms: [
        taken,
        roomDoc(nile.id, 'off', { isActive: false }),
        roomDoc(nile.id, 'free'),
      ],
    });
    const view = await service.availableRooms(nile.id, stay, undefined, NOW);
    expect(view.rooms.map((r) => r.name)).toEqual(['free']);
  });

  it('answers 404 for a malformed or unknown hotel id', async () => {
    const { service } = build({ single: null });
    await expect(
      service.availableRooms('not-an-id', stay, undefined, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.availableRooms(
        new Types.ObjectId().toString(),
        stay,
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Same visibility rule as the hotel page: a deactivated hotel is hidden from the public.
  it('hides a deactivated hotel from guests but not from admins or its own moderator', async () => {
    const off = hotelDoc('Off', { isActive: false });
    const { service } = build({ single: off });
    await expect(
      service.availableRooms(off.id, stay, undefined, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    const admin = { id: 'a', role: Role.ADMIN };
    await expect(
      service.availableRooms(off.id, stay, admin, NOW),
    ).resolves.toMatchObject({ rooms: [] });
    const own = { id: 'm', role: Role.HOTEL_MODERATOR, providerId: off.id };
    await expect(
      service.availableRooms(off.id, stay, own, NOW),
    ).resolves.toMatchObject({ rooms: [] });
  });

  it('validates the dates like the search does', async () => {
    const nile = hotelDoc('Nile');
    const { service, rooms } = build({ single: nile });
    await expect(
      service.availableRooms(
        nile.id,
        { checkIn: '2027-03-13', checkOut: '2027-03-10' },
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.availableRooms(
        nile.id,
        { checkIn: '2026-12-01', checkOut: '2026-12-03' },
        undefined,
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rooms.find).not.toHaveBeenCalled();
  });
});
