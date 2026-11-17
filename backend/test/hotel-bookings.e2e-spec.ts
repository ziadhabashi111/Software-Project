import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import {
  HotelInventoryRegistry,
  InventoryHotel,
  InventoryRoom,
} from '../src/hotel-bookings/hotel-inventory';
import { HotelReservationsService } from '../src/hotel-bookings/hotel-reservations.service';
import { ReservationStatus } from '../src/hotel-bookings/reservation-status';
import type { HotelReservationView } from '../src/hotel-bookings/reservation-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from '../src/hotel-bookings/schemas/hotel-reservation.schema';
import {
  RoomNight,
  RoomNightDocument,
} from '../src/hotel-bookings/schemas/room-night.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  statusCode: number;
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

describe('Hotel reservation holds (HTL-16, HTL-18; real MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let reservations: Model<HotelReservationDocument>;
  let nights: Model<RoomNightDocument>;
  let service: HotelReservationsService;
  let counter = 0;

  /** Fake hotels module (Abdelrahman's side of HotelInventory). */
  const hotels = new Map<string, InventoryHotel>();
  const rooms = new Map<string, InventoryRoom>();

  const activeHotel: InventoryHotel = {
    id: new Types.ObjectId().toHexString(),
    name: 'Nile View Hotel',
    active: true,
  };
  const otherHotel: InventoryHotel = {
    id: new Types.ObjectId().toHexString(),
    name: 'Other Hotel',
    active: true,
  };
  const inactiveHotel: InventoryHotel = {
    id: new Types.ObjectId().toHexString(),
    name: 'Closed Hotel',
    active: false,
  };

  function addRoom(overrides: Partial<InventoryRoom> = {}): string {
    const id = new Types.ObjectId().toHexString();
    rooms.set(id, {
      id,
      hotelId: activeHotel.id,
      name: `R${rooms.size + 1}`,
      type: 'Double',
      maxOccupancy: 2,
      pricePerNight: 100,
      bookable: true,
      ...overrides,
    });
    return id;
  }

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [HotelBookingsModule],
      replSet: true,
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    service = ctx.moduleRef.get(HotelReservationsService);
    reservations = ctx.moduleRef.get(getModelToken(HotelReservation.name));
    nights = ctx.moduleRef.get(getModelToken(RoomNight.name));
    // Unique (room, night) index must exist before the parallel tests.
    await nights.syncIndexes();
    await reservations.syncIndexes();

    [activeHotel, otherHotel, inactiveHotel].forEach((h) =>
      hotels.set(h.id, h),
    );
    ctx.moduleRef.get(HotelInventoryRegistry).register({
      findHotel: (id) => Promise.resolve(hotels.get(id) ?? null),
      findRooms: (hotelId, ids) =>
        Promise.resolve(
          ids
            .map((id) => rooms.get(id))
            .filter(
              (room): room is InventoryRoom =>
                room !== undefined && room.hotelId === hotelId,
            ),
        ),
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(role: Role = Role.USER) {
    counter += 1;
    const email = `guest${counter}@example.com`;
    const doc = await users.create({
      name: `Guest ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: doc.id, client };
  }

  type Client = Awaited<ReturnType<typeof loggedInAs>>['client'];

  function body(
    roomIds: string[],
    checkIn: string,
    checkOut: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      hotelId: activeHotel.id,
      checkIn,
      checkOut,
      rooms: roomIds.map((roomId) => ({ roomId, adults: 1, childrenAges: [] })),
      ...overrides,
    };
  }

  const hold = (client: Client, payload: object) =>
    client.post('/api/hotel-bookings').send(payload);

  const nightsOfRoom = (roomId: string) =>
    nights.countDocuments({ room: new Types.ObjectId(roomId) });

  describe('access control', () => {
    it('needs a login', async () => {
      await request(ctx.server)
        .post('/api/hotel-bookings')
        .send(body([addRoom()], '2027-01-01', '2027-01-02'))
        .expect(401);
    });

    it.each([Role.ADMIN, Role.HOTEL_MODERATOR, Role.AIRLINE_MODERATOR])(
      'is for registered users only (%s gets 403)',
      async (role) => {
        const { client } = await loggedInAs(role);
        await hold(
          client,
          body([addRoom()], '2027-01-01', '2027-01-02'),
        ).expect(403);
      },
    );
  });

  describe('a successful hold', () => {
    it('holds every room for 10 minutes as one Pending Payment reservation, priced at booking time', async () => {
      const { id: userId, client } = await loggedInAs();
      const r1 = addRoom({ pricePerNight: 120, maxOccupancy: 3 });
      const r2 = addRoom({ pricePerNight: 80.5 });
      const before = Date.now();

      const res = await hold(client, {
        hotelId: activeHotel.id,
        checkIn: '2027-02-01',
        checkOut: '2027-02-04',
        rooms: [
          { roomId: r1, adults: 2, childrenAges: [6] },
          { roomId: r2, adults: 0, childrenAges: [15, 17] },
        ],
      }).expect(201);
      const view = res.body as HotelReservationView;

      expect(view.status).toBe(ReservationStatus.PENDING_PAYMENT);
      expect(view.nights).toBe(3);
      expect(view.rooms.map((r) => r.subtotal)).toEqual([360, 241.5]);
      expect(view.totalPrice).toBe(601.5);
      expect(view.currency).toBe('USD');
      expect(view.guests).toEqual({ adults: 2, children: 3 });
      expect(view.reference).toBeNull();
      const expiresIn =
        new Date(view.holdExpiresAt as string).getTime() - before;
      expect(expiresIn).toBeGreaterThan(9.9 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(10 * 60_000 + 5_000);

      const stored = await reservations.findById(view.id).lean();
      expect(stored?.user.toString()).toBe(userId);
      expect(await nightsOfRoom(r1)).toBe(3);
      expect(await nightsOfRoom(r2)).toBe(3);

      // A later price change does not touch the reservation (snapshot).
      rooms.get(r1)!.pricePerNight = 999;
      const again = await reservations.findById(view.id).lean();
      expect(again?.totalPrice).toBe(601.5);
    });

    it('lets back-to-back stays share the changeover day', async () => {
      const { client } = await loggedInAs();
      const r = addRoom();
      await hold(client, body([r], '2027-02-10', '2027-02-12')).expect(201);
      await hold(client, body([r], '2027-02-12', '2027-02-13')).expect(201);
      await hold(client, body([r], '2027-02-08', '2027-02-10')).expect(201);
    });
  });

  describe('validation (rejected, nothing held)', () => {
    let client: Client;
    beforeAll(async () => {
      ({ client } = await loggedInAs());
    });

    const cases: [string, () => object, string][] = [
      [
        'check-in in the past',
        () => body([addRoom()], '2020-01-01', '2020-01-03'),
        'CHECK_IN_IN_PAST',
      ],
      [
        'check-out not after check-in',
        () => body([addRoom()], '2027-03-05', '2027-03-05'),
        'CHECK_OUT_NOT_AFTER_CHECK_IN',
      ],
      [
        'a stay longer than 30 nights',
        () => body([addRoom()], '2027-03-01', '2027-05-01'),
        'STAY_TOO_LONG',
      ],
      [
        'no adult in the reservation',
        () => ({
          ...body([], '2027-03-01', '2027-03-02'),
          rooms: [{ roomId: addRoom(), adults: 0, childrenAges: [10] }],
        }),
        'NO_ADULT',
      ],
      [
        'a room over its maximum occupancy',
        () => ({
          ...body([], '2027-03-01', '2027-03-02'),
          rooms: [{ roomId: addRoom(), adults: 2, childrenAges: [3] }],
        }),
        'OVER_OCCUPANCY',
      ],
      [
        'a room of another hotel',
        () =>
          body(
            [addRoom({ hotelId: otherHotel.id })],
            '2027-03-01',
            '2027-03-02',
          ),
        'ROOM_NOT_IN_HOTEL',
      ],
      [
        'a blocked, inactive or unavailable room',
        () => body([addRoom({ bookable: false })], '2027-03-01', '2027-03-02'),
        'ROOM_NOT_AVAILABLE',
      ],
    ];

    it.each(cases)('%s -> 400', async (_name, make, code) => {
      const payload = make() as { rooms: { roomId: string }[] };
      const res = await hold(client, payload).expect(400);
      expect((res.body as ErrorBody).code).toBe(code);
      for (const room of payload.rooms) {
        expect(await nightsOfRoom(room.roomId)).toBe(0);
      }
    });

    it.each([
      [
        'a child aged 18',
        { rooms: [{ roomId: 'x', adults: 1, childrenAges: [18] }] },
      ],
      ['the same room twice', 'duplicate'],
      ['an unknown property', { price: 1 }],
      ['no rooms', { rooms: [] }],
      ['a bad date', { checkIn: '2027-02-30' }],
    ])('%s -> 400 with field errors', async (_name, extra) => {
      const r = addRoom();
      const payload =
        extra === 'duplicate'
          ? body([r, r], '2027-03-01', '2027-03-02')
          : {
              ...body([r], '2027-03-01', '2027-03-02'),
              ...(extra as object),
            };
      const res = await hold(client, payload).expect(400);
      expect((res.body as ErrorBody).errors?.length).toBeGreaterThan(0);
    });

    it('a deactivated or unknown hotel -> 404', async () => {
      await hold(
        client,
        body(
          [addRoom({ hotelId: inactiveHotel.id })],
          '2027-03-01',
          '2027-03-02',
          {
            hotelId: inactiveHotel.id,
          },
        ),
      ).expect(404);
      await hold(
        client,
        body([addRoom()], '2027-03-01', '2027-03-02', {
          hotelId: new Types.ObjectId().toHexString(),
        }),
      ).expect(404);
    });
  });

  describe('no overlapping reservations', () => {
    it('rejects a hold that overlaps a live hold on the same room', async () => {
      const a = await loggedInAs();
      const b = await loggedInAs();
      const r = addRoom();
      await hold(a.client, body([r], '2027-04-01', '2027-04-05')).expect(201);
      const res = await hold(
        b.client,
        body([r], '2027-04-04', '2027-04-06'),
      ).expect(409);
      expect((res.body as ErrorBody).code).toBe('ROOMS_UNAVAILABLE');
      expect(await reservations.countDocuments({ user: b.id })).toBe(0);
    });

    it('rejects a hold that overlaps a Confirmed reservation', async () => {
      const a = await loggedInAs();
      const b = await loggedInAs();
      const r = addRoom();
      const res = await hold(
        a.client,
        body([r], '2027-04-10', '2027-04-12'),
      ).expect(201);
      const id = (res.body as HotelReservationView).id;
      // Confirmed: the nights lose their expiry (what payment confirmation does).
      await reservations.updateOne(
        { _id: id },
        { status: ReservationStatus.CONFIRMED, $unset: { holdExpiresAt: 1 } },
      );
      await nights.updateMany(
        { reservation: id },
        { $unset: { holdExpiresAt: 1 } },
      );
      // Even long after the original hold would have expired.
      await service.expireDueHolds(new Date(Date.now() + 60 * 60_000));
      await hold(b.client, body([r], '2027-04-11', '2027-04-13')).expect(409);
    });

    it('multi-room is all-or-nothing: one taken room rejects the whole request', async () => {
      const a = await loggedInAs();
      const b = await loggedInAs();
      const c = await loggedInAs();
      const taken = addRoom();
      const free = addRoom();
      await hold(a.client, body([taken], '2027-05-01', '2027-05-03')).expect(
        201,
      );

      await hold(
        b.client,
        body([free, taken], '2027-05-02', '2027-05-04'),
      ).expect(409);
      expect(await nightsOfRoom(free)).toBe(0);
      expect(await reservations.countDocuments({ user: b.id })).toBe(0);

      // The free room really was not held.
      await hold(c.client, body([free], '2027-05-02', '2027-05-04')).expect(
        201,
      );
    });
  });

  describe('parallel requests', () => {
    it('many users racing for the same room: exactly one hold wins', async () => {
      const racers = await Promise.all(
        Array.from({ length: 8 }, () => loggedInAs()),
      );
      const r = addRoom();
      const results = await Promise.all(
        racers.map(({ client }) =>
          hold(client, body([r], '2027-06-01', '2027-06-04')),
        ),
      );
      const statuses = results.map((res) => res.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(await nightsOfRoom(r)).toBe(3);
      expect(
        await reservations.countDocuments({
          'rooms.room': new Types.ObjectId(r),
        }),
      ).toBe(1);
    });

    it('overlapping multi-room requests in parallel never leave a partial hold', async () => {
      const racers = await Promise.all(
        Array.from({ length: 6 }, () => loggedInAs()),
      );
      const [r1, r2, r3] = [addRoom(), addRoom(), addRoom()];
      // Every request shares r2, so only one can win; the others hold nothing.
      const requests = racers.map(({ client }, i) =>
        hold(
          client,
          body(i % 2 === 0 ? [r1, r2] : [r2, r3], '2027-07-01', '2027-07-03'),
        ),
      );
      const results = await Promise.all(requests);
      expect(results.filter((res) => res.status === 201)).toHaveLength(1);
      expect(results.filter((res) => res.status === 409)).toHaveLength(5);

      const winner = results.find((res) => res.status === 201)!
        .body as HotelReservationView;
      const winnerRooms = winner.rooms.map((room) => room.roomId).sort();
      const held = await nights.find({ room: { $in: [r1, r2, r3] } }).lean();
      // Exactly the winner's rooms, all of their nights, nothing else.
      expect(held).toHaveLength(4);
      expect(held.every((n) => n.reservation.toString() === winner.id)).toBe(
        true,
      );
      expect([...new Set(held.map((n) => n.room.toString()))].sort()).toEqual(
        winnerRooms,
      );
    });
  });

  describe('hold expiry', () => {
    async function expire(id: string) {
      const past = new Date(Date.now() - 1_000);
      await reservations.updateOne({ _id: id }, { holdExpiresAt: past });
      await nights.updateMany({ reservation: id }, { holdExpiresAt: past });
    }

    it('an expired hold no longer blocks the room and becomes Expired', async () => {
      const a = await loggedInAs();
      const b = await loggedInAs();
      const r = addRoom();
      const first = await hold(
        a.client,
        body([r], '2027-08-01', '2027-08-03'),
      ).expect(201);
      const firstId = (first.body as HotelReservationView).id;
      await expire(firstId);

      await hold(b.client, body([r], '2027-08-02', '2027-08-04')).expect(201);
      const old = await reservations.findById(firstId).lean();
      expect(old?.status).toBe(ReservationStatus.EXPIRED);
      expect(await nights.countDocuments({ reservation: firstId })).toBe(0);
    });

    it('the expiry job expires unpaid holds and releases their rooms', async () => {
      const a = await loggedInAs();
      const r1 = addRoom();
      const r2 = addRoom();
      const res = await hold(
        a.client,
        body([r1, r2], '2027-09-01', '2027-09-03'),
      ).expect(201);
      const id = (res.body as HotelReservationView).id;

      expect(await service.expireDueHolds()).toBe(0);
      await expire(id);
      expect(await service.expireDueHolds()).toBeGreaterThanOrEqual(1);

      expect((await reservations.findById(id).lean())?.status).toBe(
        ReservationStatus.EXPIRED,
      );
      expect(await nightsOfRoom(r1)).toBe(0);
      expect(await nightsOfRoom(r2)).toBe(0);
      // Running it again changes nothing.
      expect(await service.expireDueHolds()).toBe(0);
    });
  });
});
