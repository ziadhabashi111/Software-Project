import { Module } from '@nestjs/common';
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
import { HotelReservationPayments } from '../src/hotel-bookings/hotel-reservation-payments';
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
import { NOTIFICATION_SERVICE } from '../src/notifications/notification.service.interface';
import { PAYMENT_SERVICE } from '../src/payments/payment.service.interface';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  statusCode: number;
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

/** Stand-ins for Ziad's notification and payment services. */
const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
const paymentService = {
  cancelPendingPayment: jest.fn().mockResolvedValue(undefined),
};

@Module({
  providers: [
    { provide: NOTIFICATION_SERVICE, useValue: notifications },
    { provide: PAYMENT_SERVICE, useValue: paymentService },
  ],
})
class FakeSharedServicesModule {}

describe('Hotel reservation holds (HTL-16, HTL-18; real MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let reservations: Model<HotelReservationDocument>;
  let nights: Model<RoomNightDocument>;
  let service: HotelReservationsService;
  let payments: HotelReservationPayments;
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
      extraModules: [HotelBookingsModule, FakeSharedServicesModule],
      replSet: true,
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    service = ctx.moduleRef.get(HotelReservationsService);
    payments = ctx.moduleRef.get(HotelReservationPayments);
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

  async function loggedInAs(role: Role = Role.USER, providerId?: string) {
    counter += 1;
    const email = `guest${counter}@example.com`;
    const doc = await users.create({
      name: `Guest ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
      ...(providerId ? { providerId } : {}),
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
  /** Holds one room for the given dates and returns the reservation. */
  async function holdOne(
    client: Client,
    checkIn: string,
    checkOut: string,
  ): Promise<HotelReservationView> {
    const res = await hold(client, body([addRoom()], checkIn, checkOut)).expect(
      201,
    );
    return res.body as HotelReservationView;
  }

  const paid = (view: HotelReservationView, intent = `pi_${view.id}`) => ({
    paymentIntentId: intent,
    amount: view.totalPrice,
    currency: 'usd',
  });

  async function setDates(id: string, checkIn: string, checkOut: string) {
    await reservations.updateOne(
      { _id: id },
      {
        checkIn: new Date(`${checkIn}T00:00:00.000Z`),
        checkOut: new Date(`${checkOut}T00:00:00.000Z`),
      },
    );
  }

  describe('payment confirmation (HTL-17, PAY-01)', () => {
    beforeEach(() => {
      notifications.notify.mockClear();
      paymentService.cancelPendingPayment.mockClear();
    });

    it('confirms every room, assigns a unique reference and notifies the user', async () => {
      const { id: userId, client } = await loggedInAs();
      const r1 = addRoom();
      const r2 = addRoom();
      const held = (
        await hold(client, body([r1, r2], '2027-10-01', '2027-10-03')).expect(
          201,
        )
      ).body as HotelReservationView;

      const result = await payments.confirmPaid(held.id, paid(held));
      expect(result.outcome).toBe('confirmed');
      if (result.outcome !== 'confirmed') return;
      expect(result.reservation.status).toBe(ReservationStatus.CONFIRMED);
      expect(result.reservation.reference).toMatch(/^HTL-[A-Z2-9]{8}$/);
      expect(result.reservation.holdExpiresAt).toBeNull();
      expect(result.reservation.payment).toEqual({
        status: 'succeeded',
        amount: held.totalPrice,
        currency: 'USD',
      });

      // The nights no longer expire: the rooms stay taken.
      expect(
        await nights.countDocuments({
          reservation: held.id,
          holdExpiresAt: { $exists: true },
        }),
      ).toBe(0);
      expect(await nights.countDocuments({ reservation: held.id })).toBe(4);
      await service.expireDueHolds(new Date(Date.now() + 60 * 60_000));
      expect((await reservations.findById(held.id).lean())?.status).toBe(
        ReservationStatus.CONFIRMED,
      );

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      const [to, type, message] = notifications.notify.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(to).toBe(userId);
      expect(type).toBe('HOTEL_BOOKING_CONFIRMED');
      expect(message).toContain(result.reservation.reference as string);
      expect(message).toContain('Nile View Hotel');
    });

    it('is idempotent for webhook retries of the same payment', async () => {
      const { client } = await loggedInAs();
      const held = await holdOne(client, '2027-10-05', '2027-10-06');
      const first = await payments.confirmPaid(held.id, paid(held));
      const second = await payments.confirmPaid(held.id, paid(held));

      expect(second.outcome).toBe('already_confirmed');
      if (first.outcome === 'rejected' || second.outcome === 'rejected') {
        throw new Error('expected both to succeed');
      }
      expect(second.reservation.reference).toBe(first.reservation.reference);
      expect(notifications.notify).toHaveBeenCalledTimes(1);

      // A different payment for an already confirmed reservation is refused.
      expect(
        await payments.confirmPaid(held.id, paid(held, 'pi_other')),
      ).toEqual({ outcome: 'rejected', reason: 'NOT_PENDING' });
    });

    it('refuses a payment for the wrong amount or currency (nothing changes)', async () => {
      const { client } = await loggedInAs();
      const held = await holdOne(client, '2027-10-07', '2027-10-08');
      expect(
        await payments.confirmPaid(held.id, {
          ...paid(held),
          amount: held.totalPrice - 1,
        }),
      ).toEqual({ outcome: 'rejected', reason: 'AMOUNT_MISMATCH' });
      expect(
        await payments.confirmPaid(held.id, { ...paid(held), currency: 'eur' }),
      ).toEqual({ outcome: 'rejected', reason: 'AMOUNT_MISMATCH' });
      const stored = await reservations.findById(held.id).lean();
      expect(stored?.status).toBe(ReservationStatus.PENDING_PAYMENT);
      expect(stored?.reference).toBeUndefined();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('refuses a payment that arrives after the hold expired', async () => {
      const { client } = await loggedInAs();
      const held = await holdOne(client, '2027-10-09', '2027-10-10');
      const later = new Date(Date.now() + 11 * 60_000);
      expect(await payments.confirmPaid(held.id, paid(held), later)).toEqual({
        outcome: 'rejected',
        reason: 'HOLD_EXPIRED',
      });
      expect((await reservations.findById(held.id).lean())?.status).toBe(
        ReservationStatus.PENDING_PAYMENT,
      );
    });

    it('refuses an unknown reservation', async () => {
      const missing = { paymentIntentId: 'pi_x', amount: 1, currency: 'usd' };
      expect(
        await payments.confirmPaid(new Types.ObjectId().toHexString(), missing),
      ).toEqual({ outcome: 'rejected', reason: 'NOT_FOUND' });
      expect(await payments.confirmPaid('not-an-id', missing)).toEqual({
        outcome: 'rejected',
        reason: 'NOT_FOUND',
      });
    });

    it('gives each confirmed reservation a different reference', async () => {
      const { client } = await loggedInAs();
      const refs = new Set<string>();
      for (let i = 0; i < 5; i += 1) {
        const held = await holdOne(client, '2027-10-11', '2027-10-12');
        const result = await payments.confirmPaid(held.id, paid(held));
        if (result.outcome !== 'confirmed') throw new Error(result.outcome);
        refs.add(result.reservation.reference as string);
      }
      expect(refs.size).toBe(5);
    });

    it('tells the payments module what to charge, only for the owner and a live hold', async () => {
      const owner = await loggedInAs();
      const stranger = await loggedInAs();
      const held = await holdOne(owner.client, '2027-10-13', '2027-10-15');

      const payable = await payments.forPayment(held.id, owner.id);
      expect(payable).toMatchObject({
        reservationId: held.id,
        userId: owner.id,
        amount: held.totalPrice,
        currency: 'USD',
        paymentIntentId: null,
      });
      await expect(payments.forPayment(held.id, stranger.id)).rejects.toThrow(
        'Reservation not found',
      );

      expect(
        await payments.attachPaymentIntent(
          held.id,
          'pi_123',
          'requires_payment_method',
        ),
      ).toBe(true);
      expect(
        (await payments.forPayment(held.id, owner.id)).paymentIntentId,
      ).toBe('pi_123');

      await expect(
        payments.forPayment(
          held.id,
          owner.id,
          new Date(Date.now() + 11 * 60_000),
        ),
      ).rejects.toThrow('hold has expired');
    });

    it('cancels the PaymentIntent of a hold that expires', async () => {
      const { client } = await loggedInAs();
      const held = await holdOne(client, '2027-10-16', '2027-10-17');
      await service.expireDueHolds(new Date(Date.now() + 11 * 60_000));
      expect(paymentService.cancelPendingPayment).toHaveBeenCalledWith(
        'hotel',
        held.id,
      );
    });
  });

  describe('my reservations (HTL-20) and details', () => {
    type Page = {
      group: string;
      items: HotelReservationView[];
      total: number;
      page: number;
      limit: number;
    };
    let owner: Awaited<ReturnType<typeof loggedInAs>>;
    let confirmed: HotelReservationView;
    let pendingLive: HotelReservationView;
    let pendingExpired: HotelReservationView;
    let cancelled: HotelReservationView;
    let stayedOver: HotelReservationView;

    beforeAll(async () => {
      owner = await loggedInAs();
      const c = owner.client;
      confirmed = await holdOne(c, '2027-11-10', '2027-11-12');
      await payments.confirmPaid(confirmed.id, paid(confirmed));
      pendingLive = await holdOne(c, '2027-11-01', '2027-11-02');
      pendingExpired = await holdOne(c, '2027-11-20', '2027-11-21');
      await reservations.updateOne(
        { _id: pendingExpired.id },
        { holdExpiresAt: new Date(Date.now() - 1_000) },
      );
      cancelled = await holdOne(c, '2027-11-25', '2027-11-26');
      await payments.confirmPaid(cancelled.id, paid(cancelled));
      await reservations.updateOne(
        { _id: cancelled.id },
        { status: ReservationStatus.CANCELLED, cancelledAt: new Date() },
      );
      // A confirmed stay whose check-out date has passed (job not run yet).
      stayedOver = await holdOne(c, '2027-11-27', '2027-11-28');
      await payments.confirmPaid(stayedOver.id, paid(stayedOver));
      await setDates(stayedOver.id, '2020-01-01', '2020-01-03');
    });

    const list = async (client: Client, query: string) =>
      (await client.get(`/api/hotel-bookings${query}`).expect(200))
        .body as Page;

    it('upcoming (the default): live holds and Confirmed stays, soonest first', async () => {
      const page = await list(owner.client, '');
      expect(page.group).toBe('upcoming');
      expect(page.items.map((r) => r.id)).toEqual([
        pendingLive.id,
        confirmed.id,
      ]);
      expect(page.items[1].reference).toMatch(/^HTL-/);
      expect(page.items[1].guests).toEqual({ adults: 1, children: 0 });
    });

    it('past: completed stays and expired holds, shown with their real status', async () => {
      const page = await list(owner.client, '?group=past');
      const byId = new Map(page.items.map((r) => [r.id, r.status]));
      expect(page.total).toBe(2);
      expect(byId.get(stayedOver.id)).toBe(ReservationStatus.COMPLETED);
      expect(byId.get(pendingExpired.id)).toBe(ReservationStatus.EXPIRED);
    });

    it('cancelled', async () => {
      const page = await list(owner.client, '?group=cancelled');
      expect(page.items.map((r) => r.id)).toEqual([cancelled.id]);
      expect(page.items[0].cancelledAt).not.toBeNull();
    });

    it('is paginated (GEN-05)', async () => {
      const page = await list(owner.client, '?group=upcoming&limit=1&page=2');
      expect(page).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(page.items.map((r) => r.id)).toEqual([confirmed.id]);
    });

    it('shows only my own reservations', async () => {
      const other = await loggedInAs();
      const page = await list(other.client, '?group=upcoming');
      expect(page.total).toBe(0);
    });

    it('rejects an unknown group and non-users', async () => {
      await owner.client.get('/api/hotel-bookings?group=soon').expect(400);
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client.get('/api/hotel-bookings').expect(403);
    });

    it('details: the owner sees payment status (confirmation page)', async () => {
      const res = await owner.client
        .get(`/api/hotel-bookings/${confirmed.id}`)
        .expect(200);
      const view = res.body as HotelReservationView;
      expect(view.status).toBe(ReservationStatus.CONFIRMED);
      expect(view.payment?.status).toBe('succeeded');
      expect(view.refund).toBeNull();
      expect(view.rooms).toHaveLength(1);
    });

    it('details: admins and the hotel moderator may look, nobody else (ACC-11)', async () => {
      const url = `/api/hotel-bookings/${confirmed.id}`;
      await (await loggedInAs()).client.get(url).expect(404);
      await (await loggedInAs(Role.ADMIN)).client.get(url).expect(200);
      await (
        await loggedInAs(Role.HOTEL_MODERATOR, activeHotel.id)
      ).client
        .get(url)
        .expect(200);
      await (
        await loggedInAs(Role.HOTEL_MODERATOR, otherHotel.id)
      ).client
        .get(url)
        .expect(404);
      await (
        await loggedInAs(Role.AIRLINE_MODERATOR)
      ).client
        .get(url)
        .expect(403);
      await owner.client.get('/api/hotel-bookings/not-an-id').expect(404);
      await owner.client
        .get(`/api/hotel-bookings/${new Types.ObjectId().toHexString()}`)
        .expect(404);
    });
  });

  describe('Confirmed -> Completed after check-out (GEN-11, HTL-23)', () => {
    it('completes only stays whose check-out date has passed', async () => {
      const { client } = await loggedInAs();
      const done = await holdOne(client, '2027-12-01', '2027-12-02');
      const future = await holdOne(client, '2027-12-03', '2027-12-04');
      await payments.confirmPaid(done.id, paid(done));
      await payments.confirmPaid(future.id, paid(future));
      await setDates(done.id, '2021-05-01', '2021-05-03');

      expect(await service.completeFinishedStays()).toBeGreaterThanOrEqual(1);
      const doneNow = await reservations.findById(done.id).lean();
      expect(doneNow?.status).toBe(ReservationStatus.COMPLETED);
      expect(doneNow?.completedAt).toBeInstanceOf(Date);
      expect((await reservations.findById(future.id).lean())?.status).toBe(
        ReservationStatus.CONFIRMED,
      );
    });
  });
});
