import { Types } from 'mongoose';
import { ProviderDirectory, ProviderType } from '../admin/provider-directory';
import { HotelInventoryRegistry } from '../hotel-bookings/hotel-inventory';
import type { HotelReservationQueries } from '../hotel-bookings/hotel-reservation-queries';
import { parseDate } from '../hotel-bookings/stay-rules';
import { HotelCatalog } from './hotel-catalog';
import type { Model } from 'mongoose';
import type { Hotel } from './schemas/hotel.schema';
import type { Room } from './schemas/room.schema';

const HOTEL_ID = new Types.ObjectId().toString();
const range = (from: string, to: string) => ({
  from: parseDate(from),
  to: parseDate(to),
});

function roomDoc(overrides: Record<string, unknown> = {}) {
  const _id = new Types.ObjectId();
  return {
    id: _id.toString(),
    _id,
    hotel: new Types.ObjectId(HOTEL_ID),
    name: '101',
    type: 'Double',
    maxOccupancy: 3,
    pricePerNight: 120,
    isActive: true,
    availability: [range('2027-03-01', '2027-03-31')],
    blocked: [],
    ...overrides,
  };
}

function build(options: {
  hotel?: Record<string, unknown> | null;
  rooms?: ReturnType<typeof roomDoc>[];
  guests?: string[];
}) {
  const hotelDoc =
    options.hotel === null
      ? null
      : {
          id: HOTEL_ID,
          name: 'Nile View',
          isActive: true,
          cancellationTiers: [
            { daysBefore: 14, refundPercent: 100 },
            { daysBefore: 3, refundPercent: 50 },
          ],
          save: jest.fn().mockResolvedValue(undefined),
          ...options.hotel,
        };
  const hotels = {
    findById: jest.fn().mockResolvedValue(hotelDoc),
    exists: jest.fn().mockResolvedValue(hotelDoc ? { _id: HOTEL_ID } : null),
  };
  const rooms = { find: jest.fn().mockResolvedValue(options.rooms ?? []) };
  const queries = {
    confirmedGuestIds: jest.fn().mockResolvedValue(options.guests ?? []),
  };
  const registry = new HotelInventoryRegistry();
  const directory = new ProviderDirectory();
  const catalog = new HotelCatalog(
    hotels as unknown as Model<Hotel>,
    rooms as unknown as Model<Room>,
    registry,
    directory,
    queries as unknown as HotelReservationQueries,
  );
  return { catalog, hotels, rooms, registry, directory, hotelDoc };
}

describe('HotelCatalog as the hotel inventory (HTL-16, HTL-18)', () => {
  it('registers with the booking module and the admin on start-up', () => {
    const { catalog, registry, directory } = build({});
    catalog.onModuleInit();
    expect(registry.get()).toBe(catalog);
    expect(directory.get(ProviderType.HOTEL)).toBe(catalog);
  });

  it('describes a hotel with its active flag and cancellation tiers', async () => {
    const { catalog } = build({});
    expect(await catalog.findHotel(HOTEL_ID)).toEqual({
      id: HOTEL_ID,
      name: 'Nile View',
      active: true,
      cancellationTiers: [
        { daysBefore: 14, refundPercent: 100 },
        { daysBefore: 3, refundPercent: 50 },
      ],
    });
  });

  it('reports a deactivated hotel as inactive, and an unknown or malformed id as missing', async () => {
    expect(
      (await build({ hotel: { isActive: false } }).catalog.findHotel(HOTEL_ID))
        ?.active,
    ).toBe(false);
    expect(await build({ hotel: null }).catalog.findHotel(HOTEL_ID)).toBeNull();
    const { catalog, hotels } = build({});
    expect(await catalog.findHotel('not-an-id')).toBeNull();
    expect(hotels.findById).not.toHaveBeenCalled();
  });

  it('only asks for the requested rooms of that hotel', async () => {
    const room = roomDoc();
    const { catalog, rooms } = build({ rooms: [room] });
    await catalog.findRooms(HOTEL_ID, [room.id, 'not-an-id'], {
      checkIn: parseDate('2027-03-10'),
      checkOut: parseDate('2027-03-12'),
    });
    const [filter] = rooms.find.mock.calls[0] as [
      { hotel: Types.ObjectId; _id: { $in: Types.ObjectId[] } },
    ];
    expect(filter.hotel.toString()).toBe(HOTEL_ID);
    expect(filter._id.$in.map(String)).toEqual([room.id]);
  });

  it('says a room is bookable only when every night is open, not blocked and the room is active', async () => {
    const open = roomDoc({ name: 'open' });
    const blocked = roomDoc({
      name: 'blocked',
      blocked: [range('2027-03-11', '2027-03-11')],
    });
    const outside = roomDoc({
      name: 'outside',
      availability: [range('2027-04-01', '2027-04-30')],
    });
    const inactive = roomDoc({ name: 'inactive', isActive: false });
    const { catalog } = build({ rooms: [open, blocked, outside, inactive] });

    const result = await catalog.findRooms(
      HOTEL_ID,
      [open.id, blocked.id, outside.id, inactive.id],
      { checkIn: parseDate('2027-03-10'), checkOut: parseDate('2027-03-13') },
    );
    expect(Object.fromEntries(result.map((r) => [r.name, r.bookable]))).toEqual(
      {
        open: true,
        blocked: false,
        outside: false,
        inactive: false,
      },
    );
    expect(result[0]).toEqual({
      id: open.id,
      hotelId: HOTEL_ID,
      name: 'open',
      type: 'Double',
      maxOccupancy: 3,
      pricePerNight: 120,
      bookable: true,
    });
  });

  it('answers nothing for a malformed hotel id', async () => {
    const { catalog, rooms } = build({});
    expect(
      await catalog.findRooms('nope', [new Types.ObjectId().toString()], {
        checkIn: parseDate('2027-03-10'),
        checkOut: parseDate('2027-03-12'),
      }),
    ).toEqual([]);
    expect(rooms.find).not.toHaveBeenCalled();
  });
});

describe('HotelCatalog as the hotel provider (ACC-13, ACC-15)', () => {
  it('knows whether a hotel exists', async () => {
    expect(await build({}).catalog.exists(HOTEL_ID)).toBe(true);
    expect(await build({ hotel: null }).catalog.exists(HOTEL_ID)).toBe(false);
    expect(await build({}).catalog.exists('not-an-id')).toBe(false);
  });

  it('deactivates a hotel and names the guests with a Confirmed stay to notify', async () => {
    const { catalog, hotelDoc } = build({ guests: ['u1', 'u2'] });
    const change = await catalog.setActive(HOTEL_ID, false);
    expect(change).toEqual({
      name: 'Nile View',
      changed: true,
      affectedUserIds: ['u1', 'u2'],
    });
    expect(hotelDoc?.isActive).toBe(false);
    expect(hotelDoc?.save).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when the hotel is already in that state', async () => {
    const { catalog, hotelDoc } = build({});
    const change = await catalog.setActive(HOTEL_ID, true);
    expect(change?.changed).toBe(false);
    expect(hotelDoc?.save).not.toHaveBeenCalled();
  });

  it('answers null for a hotel that does not exist', async () => {
    expect(
      await build({ hotel: null }).catalog.setActive(HOTEL_ID, false),
    ).toBeNull();
    expect(await build({}).catalog.setActive('not-an-id', false)).toBeNull();
  });
});
