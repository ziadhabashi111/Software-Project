import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { HotelReservationQueries } from '../hotel-bookings/hotel-reservation-queries';
import { parseDate } from '../hotel-bookings/stay-rules';
import { RoomsService } from './rooms.service';
import type { Hotel } from './schemas/hotel.schema';
import type { Room } from './schemas/room.schema';

const PAGE = { page: 1, limit: 10 };

const HOTEL_ID = new Types.ObjectId().toString();
const moderator = {
  id: 'm1',
  role: Role.HOTEL_MODERATOR,
  providerId: HOTEL_ID,
};
const other = {
  id: 'm2',
  role: Role.HOTEL_MODERATOR,
  providerId: new Types.ObjectId().toString(),
};

const range = (from: string, to: string) => ({
  _id: new Types.ObjectId(),
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
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 120,
    isActive: true,
    availability: [range('2027-03-01', '2027-03-31')],
    blocked: [] as ReturnType<typeof range>[],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

type RoomMock = ReturnType<typeof roomDoc>;

function build(
  options: {
    room?: RoomMock | null;
    rooms?: RoomMock[];
    hotelExists?: boolean;
    taken?: string[];
    activity?: {
      roomId: string;
      night: string;
      reservationId: string;
      reference: string | null;
    }[];
    upcoming?: boolean;
    everReserved?: boolean;
  } = {},
) {
  const room = options.room === undefined ? roomDoc() : options.room;
  const rooms = {
    findOne: jest.fn().mockResolvedValue(room),
    countDocuments: jest
      .fn()
      .mockResolvedValue((options.rooms ?? (room ? [room] : [])).length),
    find: jest.fn(() => ({
      sort: jest.fn(() => ({
        skip: jest.fn(() => ({
          limit: jest
            .fn()
            .mockResolvedValue(options.rooms ?? (room ? [room] : [])),
        })),
      })),
    })),
    // A newly created room starts with nothing open and nothing blocked.
    create: jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve(roomDoc({ availability: [], blocked: [], ...data })),
      ),
    findOneAndUpdate: jest
      .fn()
      .mockImplementation(
        (_f: unknown, update: { $set: Record<string, unknown> }) =>
          Promise.resolve(room ? { ...room, ...update.$set } : null),
      ),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const hotels = {
    exists: jest
      .fn()
      .mockResolvedValue(
        options.hotelExists === false ? null : { _id: HOTEL_ID },
      ),
  };
  const reservations = {
    takenRoomIds: jest
      .fn()
      .mockResolvedValue(new Set<string>(options.taken ?? [])),
    roomActivity: jest.fn().mockResolvedValue(options.activity ?? []),
    hasUpcomingReservations: jest
      .fn()
      .mockResolvedValue(options.upcoming ?? false),
    wasEverReserved: jest.fn().mockResolvedValue(options.everReserved ?? false),
  };
  const service = new RoomsService(
    rooms as unknown as Model<Room>,
    hotels as unknown as Model<Hotel>,
    reservations as unknown as HotelReservationQueries,
  );
  return { service, rooms, hotels, reservations, room };
}

const roomIdOf = (room: RoomMock | null) => (room as RoomMock).id;
const dto = (from: string, to: string) => ({ from, to });

describe('RoomsService.create / list / update (HTL-03, HTL-05)', () => {
  const createDto = {
    name: '101',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 120,
  };

  it('adds a room to the moderator’s own hotel', async () => {
    const { service, rooms } = build();
    const view = await service.create(moderator, HOTEL_ID, createDto);
    expect(rooms.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '101',
        maxOccupancy: 3,
        pricePerNight: 120,
        hotel: new Types.ObjectId(HOTEL_ID),
      }),
    );
    expect(view).toMatchObject({
      name: '101',
      isActive: true,
      availability: [],
    });
  });

  it('answers 409 on the name when the hotel already has that room number', async () => {
    const { service, rooms } = build();
    rooms.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    await expect(
      service.create(moderator, HOTEL_ID, createDto),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps every other moderator out, before touching the database', async () => {
    const { service, rooms, hotels } = build();
    await expect(
      service.create(other, HOTEL_ID, createDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.list(other, HOTEL_ID, PAGE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(rooms.create).not.toHaveBeenCalled();
    expect(hotels.exists).not.toHaveBeenCalled();
  });

  it('answers 404 when the moderator’s hotel no longer exists', async () => {
    const { service } = build({ hotelExists: false });
    await expect(
      service.create(moderator, HOTEL_ID, createDto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the hotel’s rooms, one page at a time (GEN-05)', async () => {
    const { service } = build();
    expect(await service.list(moderator, HOTEL_ID, PAGE)).toMatchObject({
      total: 1,
      page: 1,
      limit: 10,
      items: [expect.objectContaining({ name: '101' })],
    });
  });

  it('edits beds, occupancy and price, and needs at least one of them', async () => {
    const { service, rooms, room } = build();
    const view = await service.update(moderator, HOTEL_ID, roomIdOf(room), {
      pricePerNight: 150,
    });
    expect(rooms.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { pricePerNight: 150 } },
      expect.anything(),
    );
    expect(view.pricePerNight).toBe(150);
    await expect(
      service.update(moderator, HOTEL_ID, roomIdOf(room), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 404 for a room that is not in this hotel', async () => {
    const { service } = build({ room: null });
    await expect(
      service.update(moderator, HOTEL_ID, new Types.ObjectId().toString(), {
        beds: 3,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RoomsService availability (HTL-04, HTL-05)', () => {
  it('adds a bookable range', async () => {
    const room = roomDoc({ availability: [] });
    const { service } = build({ room });
    const view = await service.addAvailability(
      moderator,
      HOTEL_ID,
      room.id,
      dto('2027-03-01', '2027-03-31'),
    );
    expect(view.availability).toMatchObject([
      { from: '2027-03-01', to: '2027-03-31' },
    ]);
    expect(room.save).toHaveBeenCalled();
  });

  it('rejects a range that overlaps an existing one, and saves nothing', async () => {
    const room = roomDoc();
    const { service } = build({ room });
    await expect(
      service.addAvailability(
        moderator,
        HOTEL_ID,
        room.id,
        dto('2027-03-31', '2027-04-10'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(room.availability).toHaveLength(1);
    expect(room.save).not.toHaveBeenCalled();
  });

  it('rejects a date that does not exist and an end before the start', async () => {
    const room = roomDoc({ availability: [] });
    const { service } = build({ room });
    await expect(
      service.addAvailability(
        moderator,
        HOTEL_ID,
        room.id,
        dto('2027-02-30', '2027-03-10'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.addAvailability(
        moderator,
        HOTEL_ID,
        room.id,
        dto('2027-03-10', '2027-03-01'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retries when another request changed the room first, so overlapping ranges can never both be saved', async () => {
    const stale = roomDoc({ availability: [] });
    stale.save.mockRejectedValueOnce(
      Object.assign(new Error('version'), { name: 'VersionError' }),
    );
    const fresh = roomDoc({
      id: stale.id,
      _id: stale._id,
      availability: [range('2027-03-05', '2027-03-10')],
    });
    const { service, rooms } = build({ room: stale });
    rooms.findOne.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    await expect(
      service.addAvailability(
        moderator,
        HOTEL_ID,
        stale.id,
        dto('2027-03-08', '2027-03-20'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rooms.findOne).toHaveBeenCalledTimes(2);
  });

  it('lets a range grow, or move into free days, without asking the bookings', async () => {
    const room = roomDoc();
    const { service, reservations } = build({ room });
    await service.updateAvailability(
      moderator,
      HOTEL_ID,
      room.id,
      room.availability[0]._id.toString(),
      dto('2027-02-15', '2027-04-15'),
    );
    expect(reservations.roomActivity).not.toHaveBeenCalled();
    expect(room.availability[0].from).toEqual(parseDate('2027-02-15'));
  });

  it('refuses to shorten a range over nights that a reservation holds', async () => {
    const room = roomDoc();
    const { service } = build({
      room,
      activity: [
        {
          roomId: room.id,
          night: '2027-03-25',
          reservationId: 'r1',
          reference: 'HTL-1',
        },
      ],
    });
    await expect(
      service.updateAvailability(
        moderator,
        HOTEL_ID,
        room.id,
        room.availability[0]._id.toString(),
        dto('2027-03-01', '2027-03-20'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(room.availability[0].to).toEqual(parseDate('2027-03-31'));
  });

  it('shortens a range when the nights it gives up are free, and ignores bookings on nights it keeps', async () => {
    const room = roomDoc();
    const { service } = build({
      room,
      activity: [
        {
          roomId: room.id,
          night: '2027-03-05',
          reservationId: 'r1',
          reference: 'HTL-1',
        },
      ],
    });
    await service.updateAvailability(
      moderator,
      HOTEL_ID,
      room.id,
      room.availability[0]._id.toString(),
      dto('2027-03-01', '2027-03-20'),
    );
    expect(room.availability[0].to).toEqual(parseDate('2027-03-20'));
  });

  it('removes a range only if no reservation holds its nights', async () => {
    const busy = roomDoc();
    await expect(
      build({
        room: busy,
        activity: [
          {
            roomId: busy.id,
            night: '2027-03-10',
            reservationId: 'r1',
            reference: null,
          },
        ],
      }).service.removeAvailability(
        moderator,
        HOTEL_ID,
        busy.id,
        busy.availability[0]._id.toString(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(busy.availability).toHaveLength(1);

    const free = roomDoc();
    const view = await build({ room: free }).service.removeAvailability(
      moderator,
      HOTEL_ID,
      free.id,
      free.availability[0]._id.toString(),
    );
    expect(view.availability).toEqual([]);
  });

  it('answers 404 for a range that is not on the room', async () => {
    const room = roomDoc();
    await expect(
      build({ room }).service.removeAvailability(
        moderator,
        HOTEL_ID,
        room.id,
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RoomsService blocking, deactivating and deleting (HTL-06)', () => {
  it('blocks a range that no reservation touches', async () => {
    const room = roomDoc();
    const { service, reservations } = build({ room });
    const view = await service.block(
      moderator,
      HOTEL_ID,
      room.id,
      dto('2027-03-10', '2027-03-12'),
    );
    expect(view.blocked).toMatchObject([
      { from: '2027-03-10', to: '2027-03-12' },
    ]);
    const [ids, from, to] = reservations.takenRoomIds.mock.calls[0] as [
      string[],
      Date,
      Date,
    ];
    expect(ids).toEqual([room.id]);
    expect(from).toEqual(parseDate('2027-03-10'));
    expect(to).toEqual(parseDate('2027-03-13')); // the end day is included
  });

  it('refuses to block nights taken by a Confirmed reservation or a live hold', async () => {
    const room = roomDoc();
    const { service } = build({ room, taken: [room.id] });
    await expect(
      service.block(
        moderator,
        HOTEL_ID,
        room.id,
        dto('2027-03-10', '2027-03-12'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(room.blocked).toHaveLength(0);
  });

  it('rejects two blocks that overlap, and lifts a block', async () => {
    const room = roomDoc({ blocked: [range('2027-03-10', '2027-03-12')] });
    const { service } = build({ room });
    await expect(
      service.block(
        moderator,
        HOTEL_ID,
        room.id,
        dto('2027-03-12', '2027-03-14'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const view = await service.unblock(
      moderator,
      HOTEL_ID,
      room.id,
      room.blocked[0]._id.toString(),
    );
    expect(view.blocked).toEqual([]);
  });

  it('refuses to deactivate a room that is taken tonight or later, and reactivates freely', async () => {
    const room = roomDoc();
    await expect(
      build({ room, upcoming: true }).service.setActive(
        moderator,
        HOTEL_ID,
        room.id,
        false,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(room.isActive).toBe(true);

    const free = roomDoc();
    expect(
      (
        await build({ room: free }).service.setActive(
          moderator,
          HOTEL_ID,
          free.id,
          false,
        )
      ).isActive,
    ).toBe(false);

    const off = roomDoc({ isActive: false });
    const { service, reservations } = build({ room: off, upcoming: true });
    expect(
      (await service.setActive(moderator, HOTEL_ID, off.id, true)).isActive,
    ).toBe(true);
    expect(reservations.hasUpcomingReservations).not.toHaveBeenCalled();
  });

  it('deletes a room that was never reserved, and refuses one that ever was', async () => {
    const free = roomDoc();
    const ok = build({ room: free });
    await ok.service.remove(moderator, HOTEL_ID, free.id);
    expect(ok.rooms.deleteOne).toHaveBeenCalled();

    const used = roomDoc();
    const refused = build({ room: used, everReserved: true });
    await expect(
      refused.service.remove(moderator, HOTEL_ID, used.id),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(refused.rooms.deleteOne).not.toHaveBeenCalled();
  });

  it('keeps every other moderator out of all of it', async () => {
    const room = roomDoc();
    const { service, rooms } = build({ room });
    const roomId = room.id;
    for (const call of [
      () =>
        service.block(other, HOTEL_ID, roomId, dto('2027-03-10', '2027-03-12')),
      () => service.setActive(other, HOTEL_ID, roomId, false),
      () => service.remove(other, HOTEL_ID, roomId),
      () =>
        service.addAvailability(
          other,
          HOTEL_ID,
          roomId,
          dto('2027-05-01', '2027-05-02'),
        ),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(rooms.findOne).not.toHaveBeenCalled();
  });
});

describe('RoomsService.availabilityView (HTL-08)', () => {
  it('shows each room night as Available, Booked (with its reference) or Blocked', async () => {
    const room = roomDoc({
      name: '101',
      availability: [range('2027-03-01', '2027-03-04')],
      blocked: [range('2027-03-03', '2027-03-03')],
    });
    const { service, reservations } = build({
      room,
      activity: [
        {
          roomId: room.id,
          night: '2027-03-02',
          reservationId: 'r1',
          reference: 'HTL-ABC',
        },
      ],
    });
    const view = await service.availabilityView(moderator, HOTEL_ID, {
      from: '2027-03-01',
      to: '2027-03-05',
    });

    expect(view).toMatchObject({
      hotelId: HOTEL_ID,
      from: '2027-03-01',
      to: '2027-03-05',
    });
    expect(view.rooms[0].nights).toEqual([
      { date: '2027-03-01', status: 'Available' },
      {
        date: '2027-03-02',
        status: 'Booked',
        reference: 'HTL-ABC',
        reservationId: 'r1',
      },
      { date: '2027-03-03', status: 'Blocked', reason: 'BLOCKED' },
      { date: '2027-03-04', status: 'Available' },
      { date: '2027-03-05', status: 'Blocked', reason: 'NOT_OFFERED' },
    ]);
    const [ids, from, to] = reservations.roomActivity.mock.calls[0] as [
      string[],
      Date,
      Date,
    ];
    expect(ids).toEqual([room.id]);
    expect(from).toEqual(parseDate('2027-03-01'));
    expect(to).toEqual(parseDate('2027-03-06')); // the end day is included
  });

  it('is for the hotel’s own moderator, and limits how long a period it will show', async () => {
    const { service } = build();
    await expect(
      service.availabilityView(other, HOTEL_ID, {
        from: '2027-03-01',
        to: '2027-03-05',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.availabilityView(moderator, HOTEL_ID, {
        from: '2027-03-01',
        to: '2027-12-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.availabilityView(moderator, HOTEL_ID, {
        from: '2027-03-10',
        to: '2027-03-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
