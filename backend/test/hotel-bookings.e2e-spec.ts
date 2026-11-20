import { Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { BlogModule } from '../src/blog/blog.module';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import {
  HotelInventoryRegistry,
  InventoryHotel,
  InventoryRoom,
} from '../src/hotel-bookings/hotel-inventory';
import {
  HotelReservationPayments,
  hotelRefundIdempotencyKey,
} from '../src/hotel-bookings/hotel-reservation-payments';
import { SharedServices } from '../src/hotel-bookings/shared-services';
import { HotelReservationQueries } from '../src/hotel-bookings/hotel-reservation-queries';
import { ReviewModerator } from '../src/hotel-bookings/review-moderator';
import { HotelReservationsService } from '../src/hotel-bookings/hotel-reservations.service';
import { ReservationStatus } from '../src/hotel-bookings/reservation-status';
import { STRIPE_WEBHOOK_RETRY_MS } from '../src/common/booking-status/hold';
import type { HotelReservationView } from '../src/hotel-bookings/reservation-view';
import type { HotelReviewView } from '../src/hotel-bookings/review-view';
import { UserStatus } from '../src/users/user-status';
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
import { REFUND_SERVICE } from '../src/payments/refund.service.interface';
import type { RefundQuote } from '../src/hotel-bookings/cancellation-rules';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

/** Nile View's policy: 100% from 30 days, 50% from 7 days, 0% after. */
const TIERS = [
  { daysBefore: 30, refundPercent: 100 },
  { daysBefore: 7, refundPercent: 50 },
];

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

const refundService = {
  preview: jest.fn(),
  issue: jest.fn((_type: string, id: string) =>
    Promise.resolve({
      refundId: `re_${id}`,
      amount: 0,
      status: 'REFUNDED' as const,
      currency: 'USD',
    }),
  ),
};

@Module({
  providers: [
    { provide: NOTIFICATION_SERVICE, useValue: notifications },
    { provide: PAYMENT_SERVICE, useValue: paymentService },
    { provide: REFUND_SERVICE, useValue: refundService },
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
    cancellationTiers: TIERS,
  };
  const otherHotel: InventoryHotel = {
    id: new Types.ObjectId().toHexString(),
    name: 'Other Hotel',
    active: true,
    cancellationTiers: TIERS,
  };
  const inactiveHotel: InventoryHotel = {
    id: new Types.ObjectId().toHexString(),
    name: 'Closed Hotel',
    active: false,
    cancellationTiers: TIERS,
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
      extraModules: [
        AuditModule,
        AdminModule,
        BlogModule,
        HotelBookingsModule,
        FakeSharedServicesModule,
      ],
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

    it('confirms a payment made inside the hold even when its webhook arrives after the hold ended', async () => {
      const { client } = await loggedInAs();
      const held = await holdOne(client, '2027-10-12', '2027-10-13');
      const later = new Date(Date.now() + 11 * 60_000);
      const result = await payments.confirmPaid(
        held.id,
        { ...paid(held), paidAt: new Date() },
        later,
      );
      expect(result.outcome).toBe('confirmed');
      expect((await reservations.findById(held.id).lean())?.status).toBe(
        ReservationStatus.CONFIRMED,
      );
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

    it('leaves a hold the user already paid to the webhook, until Stripe stops retrying (HTL-18, PAY-01)', async () => {
      const { client } = await loggedInAs();
      const held = await holdOne(client, '2027-10-20', '2027-10-21');
      paymentService.cancelPendingPayment.mockResolvedValue('not_cancellable');
      try {
        await service.expireDueHolds(new Date(Date.now() + 11 * 60_000));
        const kept = await reservations.findById(held.id).lean();
        expect(kept?.status).toBe(ReservationStatus.PENDING_PAYMENT);
        expect(await nights.countDocuments({ reservation: kept?._id })).toBe(1);

        await service.expireDueHolds(
          new Date(Date.now() + 11 * 60_000 + STRIPE_WEBHOOK_RETRY_MS),
        );
        const expired = await reservations.findById(held.id).lean();
        expect(expired?.status).toBe(ReservationStatus.EXPIRED);
      } finally {
        paymentService.cancelPendingPayment.mockResolvedValue(undefined);
      }
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
  describe('cancellation with refund (HTL-21, PAY-03)', () => {
    /** A calendar date `n` days from today (UTC), as YYYY-MM-DD. */
    const inDays = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    beforeEach(() => {
      notifications.notify.mockClear();
      refundService.issue.mockClear();
    });

    /** A Confirmed one-room, two-night reservation (total 200) and its room. */
    async function confirmedStay(client: Client, checkInIn: number) {
      const room = addRoom();
      const held = (
        await hold(
          client,
          body([room], inDays(checkInIn), inDays(checkInIn + 2)),
        ).expect(201)
      ).body as HotelReservationView;
      const result = await payments.confirmPaid(held.id, paid(held));
      if (result.outcome !== 'confirmed') throw new Error(result.outcome);
      return { room, reservation: result.reservation };
    }

    const cancelUrl = (id: string) =>
      `/api/hotel-bookings/${id}/cancel?confirm=true`;

    it('previews the refund from the tiers, on the full total', async () => {
      const { client } = await loggedInAs();
      const far = await confirmedStay(client, 40);
      const near = await confirmedStay(client, 10);
      const late = await confirmedStay(client, 3);

      const quote = async (id: string) =>
        (await client.get(`/api/hotel-bookings/${id}/cancellation`).expect(200))
          .body as RefundQuote;
      expect(await quote(far.reservation.id)).toMatchObject({
        daysBeforeCheckIn: 40,
        totalPrice: 200,
        refundPercent: 100,
        refundAmount: 200,
        currency: 'USD',
      });
      expect(await quote(near.reservation.id)).toMatchObject({
        refundPercent: 50,
        refundAmount: 100,
      });
      expect(await quote(late.reservation.id)).toMatchObject({
        refundPercent: 0,
        refundAmount: 0,
      });
    });

    it('cancels the whole reservation, releases every room, refunds and notifies', async () => {
      const owner = await loggedInAs();
      const r1 = addRoom();
      const r2 = addRoom();
      const held = (
        await hold(owner.client, body([r1, r2], inDays(10), inDays(12))).expect(
          201,
        )
      ).body as HotelReservationView;
      await payments.confirmPaid(held.id, paid(held));
      refundService.issue.mockImplementationOnce((_type, id) =>
        Promise.resolve({
          refundId: `re_${id}`,
          amount: 200,
          status: 'REFUNDED',
          currency: 'USD',
        }),
      );

      // The backend insists on the confirmation (GEN-03).
      await owner.client
        .post(`/api/hotel-bookings/${held.id}/cancel`)
        .expect(400);

      const res = await owner.client.post(cancelUrl(held.id)).expect(200);
      const { reservation, refund } = res.body as {
        reservation: HotelReservationView;
        refund: RefundQuote;
      };
      expect(reservation.status).toBe(ReservationStatus.CANCELLED);
      expect(reservation.cancelledAt).not.toBeNull();
      expect(refund).toMatchObject({ refundPercent: 50, refundAmount: 200 });
      expect(reservation.refund).toEqual({
        status: 'REFUNDED',
        amount: 200,
        percentage: 50,
        currency: 'USD',
      });
      expect(refundService.issue).toHaveBeenCalledWith('hotel', held.id);

      // Both rooms are free again for those dates.
      expect(await nights.countDocuments({ reservation: held.id })).toBe(0);
      const next = await loggedInAs();
      await hold(next.client, body([r1, r2], inDays(10), inDays(12))).expect(
        201,
      );

      expect(notifications.notify).toHaveBeenCalledWith(
        owner.id,
        'HOTEL_BOOKING_CANCELLED',
        expect.stringContaining('Refund: 200 USD (50%'),
      );
      // It now shows under Cancelled.
      const page = (
        await owner.client
          .get('/api/hotel-bookings?group=cancelled')
          .expect(200)
      ).body as { items: HotelReservationView[] };
      expect(page.items.map((r) => r.id)).toEqual([held.id]);
    });

    it('a 0% cancellation creates no Stripe refund', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 2);
      const res = await client.post(cancelUrl(reservation.id)).expect(200);
      const body = res.body as { reservation: HotelReservationView };
      expect(body.reservation.refund).toEqual({
        status: 'NONE',
        amount: 0,
        percentage: 0,
        currency: 'USD',
      });
      expect(refundService.issue).not.toHaveBeenCalled();
    });

    it('marks the refund FAILED when Stripe fails; cancelled, rooms released', async () => {
      const { client } = await loggedInAs();
      const { room, reservation } = await confirmedStay(client, 45);
      refundService.issue.mockRejectedValueOnce(
        Object.assign(new Error('Stripe is down: sk_test_secret'), {
          code: 'api_connection_error',
        }),
      );
      const res = await client.post(cancelUrl(reservation.id)).expect(200);
      const cancelled = res.body as { reservation: HotelReservationView };
      expect(cancelled.reservation.status).toBe(ReservationStatus.CANCELLED);
      expect(cancelled.reservation.refund?.status).toBe('FAILED');

      // Stored as Failed with a short code only (no message, stack, secret).
      const stored = await reservations.findById(reservation.id).lean();
      expect(stored?.status).toBe(ReservationStatus.CANCELLED);
      expect(stored?.refund?.status).toBe('FAILED');
      expect(stored?.refund?.failureReason).toBe('STRIPE_API_CONNECTION_ERROR');
      expect(JSON.stringify(stored?.refund)).not.toContain('sk_test');
      // Visible on the details page (PAY-03).
      const details = (
        await client.get(`/api/hotel-bookings/${reservation.id}`).expect(200)
      ).body as HotelReservationView;
      expect(details.refund?.status).toBe('FAILED');

      // The room is free again for those dates.
      expect(await nights.countDocuments({ reservation: reservation.id })).toBe(
        0,
      );
      const next = await loggedInAs();
      await hold(
        next.client,
        body([room], reservation.checkIn, reservation.checkOut),
      ).expect(201);

      // The refund service can read what to refund, retry safely, and record
      // the outcome.
      const basis = await payments.refundBasis(reservation.id);
      expect(basis).toMatchObject({
        paymentIntentId: `pi_${reservation.id}`,
        amount: 200,
        percentage: 100,
        status: 'FAILED',
        stripeRefundId: null,
        failureReason: 'STRIPE_API_CONNECTION_ERROR',
        idempotencyKey: hotelRefundIdempotencyKey(reservation.id),
      });
      expect(
        await payments.recordRefundResult(reservation.id, {
          refundId: 're_retry',
          amount: 200,
          status: 'REFUNDED',
          currency: 'USD',
        }),
      ).toBe(true);
      expect(await payments.refundBasis(reservation.id)).toMatchObject({
        status: 'REFUNDED',
        stripeRefundId: 're_retry',
        failureReason: null,
        idempotencyKey: hotelRefundIdempotencyKey(reservation.id),
      });
    });

    it('a generic refund error is FAILED with a generic reason', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 46);
      refundService.issue.mockRejectedValueOnce(new Error('boom'));
      await client.post(cancelUrl(reservation.id)).expect(200);
      const stored = await reservations.findById(reservation.id).lean();
      expect(stored?.refund).toMatchObject({
        status: 'FAILED',
        failureReason: 'REFUND_ISSUE_FAILED',
      });
    });

    it('marks the refund REFUNDED on success and exposes the Stripe refund id', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 47);
      refundService.issue.mockImplementationOnce((_type, id) =>
        Promise.resolve({
          refundId: `re_${id}`,
          amount: 200,
          status: 'REFUNDED',
          currency: 'USD',
        }),
      );
      const res = await client.post(cancelUrl(reservation.id)).expect(200);
      const body = res.body as { reservation: HotelReservationView };
      expect(body.reservation.refund?.status).toBe('REFUNDED');
      expect(await payments.refundBasis(reservation.id)).toMatchObject({
        status: 'REFUNDED',
        stripeRefundId: `re_${reservation.id}`,
        failureReason: null,
      });
    });

    it('keeps the refund PENDING when no refund service is wired (deploy state)', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 48);
      const shared = ctx.moduleRef.get(SharedServices);
      const spy = jest.spyOn(shared, 'refunds').mockReturnValue(undefined);
      try {
        const res = await client.post(cancelUrl(reservation.id)).expect(200);
        const body = res.body as { reservation: HotelReservationView };
        expect(body.reservation.status).toBe(ReservationStatus.CANCELLED);
        expect(body.reservation.refund?.status).toBe('PENDING');
      } finally {
        spy.mockRestore();
      }
      expect(refundService.issue).not.toHaveBeenCalled();
      expect(await payments.refundBasis(reservation.id)).toMatchObject({
        status: 'PENDING',
        stripeRefundId: null,
      });
    });

    it('a webhook replay of the same payment after cancellation is not refunded again (PAY-01)', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 10);
      refundService.issue.mockImplementationOnce((_type, id) =>
        Promise.resolve({
          refundId: `re_${id}`,
          amount: 100,
          status: 'REFUNDED',
          currency: 'USD',
        }),
      );
      await client.post(cancelUrl(reservation.id)).expect(200);
      const before = await reservations.findById(reservation.id).lean();
      expect(before?.refund).toMatchObject({ percentage: 50, amount: 100 });

      // Stripe re-delivers payment_intent.succeeded for the original payment.
      const replay = await payments.confirmPaid(
        reservation.id,
        paid(reservation),
      );
      expect(replay.outcome).toBe('already_processed');
      if (replay.outcome !== 'already_processed') return;
      expect(replay.reservation.status).toBe(ReservationStatus.CANCELLED);

      const after = await reservations.findById(reservation.id).lean();
      expect(after?.status).toBe(ReservationStatus.CANCELLED);
      expect(after?.refund).toEqual(before?.refund);
      expect(after?.payment).toEqual(before?.payment);
      expect(after?.updatedAt).toEqual(before?.updatedAt);
      expect(refundService.issue).toHaveBeenCalledTimes(1);
    });

    it('a different payment on a cancelled reservation must be refunded in full', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 11);
      await client.post(cancelUrl(reservation.id)).expect(200);
      expect(
        await payments.confirmPaid(
          reservation.id,
          paid(reservation, 'pi_someone_else'),
        ),
      ).toEqual({ outcome: 'rejected', reason: 'NOT_PENDING' });
    });

    it('uses the tiers in force when the reservation was made', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 40);
      activeHotel.cancellationTiers = [];
      try {
        const quote = (
          await client
            .get(`/api/hotel-bookings/${reservation.id}/cancellation`)
            .expect(200)
        ).body as RefundQuote;
        expect(quote.refundPercent).toBe(100);
      } finally {
        activeHotel.cancellationTiers = TIERS;
      }
    });

    it('refuses what cannot be cancelled', async () => {
      const { client } = await loggedInAs();
      const pending = await holdOne(client, inDays(20), inDays(21));
      const res = await client.post(cancelUrl(pending.id)).expect(409);
      expect((res.body as ErrorBody).code).toBe('NOT_CANCELLABLE');

      const { reservation } = await confirmedStay(client, 20);
      await client.post(cancelUrl(reservation.id)).expect(200);
      await client.post(cancelUrl(reservation.id)).expect(409);

      // On or after the check-in date.
      const started = await confirmedStay(client, 30);
      await setDates(started.reservation.id, inDays(0), inDays(2));
      const late = await client
        .post(cancelUrl(started.reservation.id))
        .expect(409);
      expect((late.body as ErrorBody).code).toBe('CHECK_IN_REACHED');
      await client
        .get(`/api/hotel-bookings/${started.reservation.id}/cancellation`)
        .expect(409);
    });

    it('only the owner can cancel or preview (others get 404, other roles 403)', async () => {
      const owner = await loggedInAs();
      const { reservation } = await confirmedStay(owner.client, 25);
      const stranger = await loggedInAs();
      await stranger.client.post(cancelUrl(reservation.id)).expect(404);
      await stranger.client
        .get(`/api/hotel-bookings/${reservation.id}/cancellation`)
        .expect(404);
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client.post(cancelUrl(reservation.id)).expect(403);
      await request(ctx.server).post(cancelUrl(reservation.id)).expect(401);
      expect((await reservations.findById(reservation.id).lean())?.status).toBe(
        ReservationStatus.CONFIRMED,
      );
    });

    it('two cancellations at once: one wins, one refund', async () => {
      const { client } = await loggedInAs();
      const { reservation } = await confirmedStay(client, 35);
      const results = await Promise.all([
        client.post(cancelUrl(reservation.id)),
        client.post(cancelUrl(reservation.id)),
        client.post(cancelUrl(reservation.id)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(refundService.issue).toHaveBeenCalledTimes(1);
    });
  });
  describe('reviews (HTL-23, HTL-24, GEN-10, ACC-12)', () => {
    interface ReviewsPage {
      averageRating: number | null;
      ratingCount: number;
      items: HotelReviewView[];
      total: number;
      page: number;
      limit: number;
    }

    /** A fresh hotel, so its average only reflects the reviews of one test. */
    function newHotel(): InventoryHotel {
      const hotel: InventoryHotel = {
        id: new Types.ObjectId().toHexString(),
        name: `Review Hotel ${hotels.size + 1}`,
        active: true,
        cancellationTiers: TIERS,
      };
      hotels.set(hotel.id, hotel);
      return hotel;
    }

    /** A paid stay at `hotel` whose check-out date has passed. */
    async function completedStay(
      client: Client,
      hotel: InventoryHotel,
      roomCount = 1,
    ): Promise<HotelReservationView> {
      const roomIds = Array.from({ length: roomCount }, () =>
        addRoom({ hotelId: hotel.id }),
      );
      const held = (
        await hold(
          client,
          body(roomIds, '2028-01-10', '2028-01-12', { hotelId: hotel.id }),
        ).expect(201)
      ).body as HotelReservationView;
      await payments.confirmPaid(held.id, paid(held));
      await setDates(held.id, '2021-01-10', '2021-01-12');
      return held;
    }

    const review = (client: Client, reservationId: string, payload: object) =>
      client.post(`/api/hotel-bookings/${reservationId}/review`).send(payload);

    const reviewsOf = async (hotelId: string, client?: Client, query = '') =>
      (
        await (client ?? request(ctx.server))
          .get(`/api/hotels/${hotelId}/reviews${query}`)
          .expect(200)
      ).body as ReviewsPage;

    it('reviews a completed stay once, whatever the number of rooms', async () => {
      const guest = await loggedInAs();
      const hotel = newHotel();
      const stay = await completedStay(guest.client, hotel, 3);

      const res = await review(guest.client, stay.id, {
        rating: 4,
        text: '  Great pool.  ',
      }).expect(201);
      const created = res.body as HotelReviewView;
      expect(created).toMatchObject({
        reservationId: stay.id,
        hotelId: hotel.id,
        rating: 4,
        text: 'Great pool.',
        isHidden: false,
        author: { id: guest.id },
      });

      const again = await review(guest.client, stay.id, { rating: 5 }).expect(
        409,
      );
      expect((again.body as ErrorBody).code).toBe('REVIEW_EXISTS');
      expect((await reviewsOf(hotel.id)).ratingCount).toBe(1);
    });

    it('reports on reviews need a visible review by someone else (GEN-09)', async () => {
      const guest = await loggedInAs();
      const reporter = await loggedInAs();
      const stay = await completedStay(guest.client, newHotel());
      const created = (
        await review(guest.client, stay.id, { rating: 2 }).expect(201)
      ).body as HotelReviewView;
      const report = (client: Client, contentId: string) =>
        client.post('/api/reports').send({
          contentType: 'review',
          contentId,
          reason: 'Fake review',
        });

      await report(reporter.client, new Types.ObjectId().toHexString()).expect(
        404,
      );
      await report(guest.client, created.id).expect(400);
      await report(reporter.client, created.id).expect(201);

      await ctx.moduleRef.get(ReviewModerator).hide(created.id);
      const other = await loggedInAs();
      await report(other.client, created.id).expect(404);
    });

    it('two reviews of one stay at once: exactly one is stored', async () => {
      const guest = await loggedInAs();
      const stay = await completedStay(guest.client, newHotel());
      const results = await Promise.all([
        review(guest.client, stay.id, { rating: 5 }),
        review(guest.client, stay.id, { rating: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('only after the stay is completed, and only my own reservation', async () => {
      const guest = await loggedInAs();
      const hotel = newHotel();
      const pending = (
        await hold(
          guest.client,
          body([addRoom({ hotelId: hotel.id })], '2028-02-01', '2028-02-02', {
            hotelId: hotel.id,
          }),
        ).expect(201)
      ).body as HotelReservationView;
      const notYet = await review(guest.client, pending.id, {
        rating: 5,
      }).expect(409);
      expect((notYet.body as ErrorBody).code).toBe('STAY_NOT_COMPLETED');

      await payments.confirmPaid(pending.id, paid(pending));
      await review(guest.client, pending.id, { rating: 5 }).expect(409);

      const done = await completedStay(guest.client, hotel);
      const stranger = await loggedInAs();
      await review(stranger.client, done.id, { rating: 1 }).expect(404);
      const admin = await loggedInAs(Role.ADMIN);
      await review(admin.client, done.id, { rating: 1 }).expect(403);
      await request(ctx.server)
        .post(`/api/hotel-bookings/${done.id}/review`)
        .send({ rating: 1 })
        .expect(401);
    });

    it.each([
      ['a rating of 0', { rating: 0 }],
      ['a rating of 6', { rating: 6 }],
      ['a fractional rating', { rating: 4.5 }],
      ['no rating', { text: 'Nice' }],
      ['a text over 1000 characters', { rating: 3, text: 'x'.repeat(1001) }],
      ['an unknown property', { rating: 3, stars: 3 }],
    ])('rejects %s (400)', async (_name, payload) => {
      const guest = await loggedInAs();
      const stay = await completedStay(guest.client, newHotel());
      await review(guest.client, stay.id, payload).expect(400);
    });

    it('lists reviews newest first with the average and count, open to guests', async () => {
      const hotel = newHotel();
      const ratings = [5, 4, 4];
      const ids: string[] = [];
      for (const rating of ratings) {
        const guest = await loggedInAs();
        const stay = await completedStay(guest.client, hotel);
        ids.push(
          (
            (await review(guest.client, stay.id, { rating }).expect(201))
              .body as HotelReviewView
          ).id,
        );
      }

      const page = await reviewsOf(hotel.id);
      expect(page.averageRating).toBe(4.3);
      expect(page.ratingCount).toBe(3);
      expect(page.items.map((r) => r.id)).toEqual([...ids].reverse());
      expect(page.items[0].author.name).toMatch(/^Guest \d+$/);

      const second = await reviewsOf(hotel.id, undefined, '?limit=2&page=2');
      expect(second).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect(second.items.map((r) => r.id)).toEqual([ids[0]]);

      const empty = await reviewsOf(newHotel().id);
      expect(empty).toMatchObject({
        averageRating: null,
        ratingCount: 0,
        total: 0,
      });
      await request(ctx.server)
        .get(`/api/hotels/${new Types.ObjectId().toHexString()}/reviews`)
        .expect(404);
    });

    it('edits and deletes my review; the average follows', async () => {
      const guest = await loggedInAs();
      const other = await loggedInAs();
      const hotel = newHotel();
      const stay = await completedStay(guest.client, hotel);
      const otherStay = await completedStay(other.client, hotel);
      await review(other.client, otherStay.id, { rating: 5 }).expect(201);
      const mine = (
        await review(guest.client, stay.id, {
          rating: 1,
          text: 'Noisy',
        }).expect(201)
      ).body as HotelReviewView;
      expect((await reviewsOf(hotel.id)).averageRating).toBe(3);

      const edited = (
        await guest.client
          .patch(`/api/reviews/${mine.id}`)
          .send({ rating: 4, text: null })
          .expect(200)
      ).body as HotelReviewView;
      expect(edited).toMatchObject({ rating: 4, text: null });
      expect((await reviewsOf(hotel.id)).averageRating).toBe(4.5);

      await guest.client.patch(`/api/reviews/${mine.id}`).send({}).expect(400);
      await other.client
        .patch(`/api/reviews/${mine.id}`)
        .send({ rating: 1 })
        .expect(404);
      await other.client.delete(`/api/reviews/${mine.id}`).expect(404);

      await guest.client.delete(`/api/reviews/${mine.id}`).expect(204);
      expect(await reviewsOf(hotel.id)).toMatchObject({
        averageRating: 5,
        ratingCount: 1,
      });
      // The stay can be reviewed again after deleting.
      await review(guest.client, stay.id, { rating: 3 }).expect(201);
    });

    it('a hidden review is shown only to its author and admins, and leaves the average', async () => {
      const author = await loggedInAs();
      const other = await loggedInAs();
      const hotel = newHotel();
      const kept = await completedStay(other.client, hotel);
      await review(other.client, kept.id, { rating: 5 }).expect(201);
      const stay = await completedStay(author.client, hotel);
      const rude = (
        await review(author.client, stay.id, { rating: 1 }).expect(201)
      ).body as HotelReviewView;

      const admin = await loggedInAs(Role.ADMIN);
      await admin.client
        .delete(`/api/admin/content/review/${rude.id}?mode=hide`)
        .expect(200);

      const guestView = await reviewsOf(hotel.id);
      expect(guestView.items.map((r) => r.id)).not.toContain(rude.id);
      expect(guestView).toMatchObject({ averageRating: 5, ratingCount: 1 });

      const authorView = await reviewsOf(hotel.id, author.client);
      expect(authorView.items.find((r) => r.id === rude.id)?.isHidden).toBe(
        true,
      );
      expect(
        (await reviewsOf(hotel.id, other.client)).items.map((r) => r.id),
      ).not.toContain(rude.id);
      expect(
        (await reviewsOf(hotel.id, admin.client)).items.map((r) => r.id),
      ).toContain(rude.id);

      // Unhide restores it for everyone (GEN-10).
      await ctx.moduleRef.get(ReviewModerator).unhide(rude.id);
      expect((await reviewsOf(hotel.id)).items.map((r) => r.id)).toContain(
        rude.id,
      );

      await admin.client
        .delete(`/api/admin/content/review/${rude.id}?mode=delete`)
        .expect(200);
      expect(
        (await reviewsOf(hotel.id, admin.client)).items.map((r) => r.id),
      ).not.toContain(rude.id);
    });

    it('reviews of a deactivated account show "Deleted user" (ACC-12)', async () => {
      const guest = await loggedInAs();
      const hotel = newHotel();
      const stay = await completedStay(guest.client, hotel);
      await review(guest.client, stay.id, { rating: 2 }).expect(201);
      await users.setStatus(guest.id, UserStatus.DEACTIVATED);

      const page = await reviewsOf(hotel.id);
      expect(page.items[0].author).toEqual({ id: null, name: 'Deleted user' });
      // It still counts towards the average.
      expect(page.ratingCount).toBe(1);
    });
  });
  describe('hooks for other modules (ACC-12, ACC-17, HTL-06, 08, 11, 22)', () => {
    let queries: HotelReservationQueries;
    beforeAll(() => {
      queries = ctx.moduleRef.get(HotelReservationQueries);
    });

    const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

    async function confirmedAt(
      client: Client,
      roomIds: string[],
      checkIn: string,
      checkOut: string,
    ): Promise<HotelReservationView> {
      const held = (
        await hold(client, body(roomIds, checkIn, checkOut)).expect(201)
      ).body as HotelReservationView;
      const result = await payments.confirmPaid(held.id, paid(held));
      if (result.outcome !== 'confirmed') throw new Error(result.outcome);
      return result.reservation;
    }

    describe('ACC-12: deactivation is blocked by an upcoming Confirmed stay', () => {
      it('blocks with a future stay, allows once it is cancelled', async () => {
        const guest = await loggedInAs();
        const stay = await confirmedAt(
          guest.client,
          [addRoom()],
          '2028-03-01',
          '2028-03-03',
        );
        const res = await guest.client
          .delete('/api/users/me?confirm=true')
          .expect(409);
        expect((res.body as ErrorBody).code).toBe('UPCOMING_BOOKINGS');

        await guest.client
          .post(`/api/hotel-bookings/${stay.id}/cancel?confirm=true`)
          .expect(200);
        await guest.client.delete('/api/users/me?confirm=true').expect(204);
      });

      it('counts a stay in progress, not a finished one or an unpaid hold', async () => {
        const guest = await loggedInAs();
        const stay = await confirmedAt(
          guest.client,
          [addRoom()],
          '2028-03-05',
          '2028-03-07',
        );
        const today = new Date().toISOString().slice(0, 10);
        await setDates(stay.id, '2020-01-01', today);
        await guest.client.delete('/api/users/me?confirm=true').expect(409);

        await setDates(stay.id, '2020-01-01', '2020-01-02');
        await hold(
          guest.client,
          body([addRoom()], '2028-03-09', '2028-03-10'),
        ).expect(201);
        await guest.client.delete('/api/users/me?confirm=true').expect(204);
      });
    });

    describe('ACC-17: hotel reservations in the admin booking list', () => {
      type Row = {
        id: string;
        reference: string;
        type: string;
        provider: { id: string; name: string };
        status: string;
        amount: number;
        user: { id: string; name?: string };
      };

      it('lists them with user, hotel, dates, amount and status, and filters', async () => {
        const guest = await loggedInAs();
        const confirmed = await confirmedAt(
          guest.client,
          [addRoom()],
          '2029-05-01',
          '2029-05-03',
        );
        const pending = (
          await hold(
            guest.client,
            body([addRoom()], '2029-05-10', '2029-05-11'),
          ).expect(201)
        ).body as HotelReservationView;
        const admin = await loggedInAs(Role.ADMIN);
        // Page size is fixed at 10 (GEN-05): walk every page.
        const list = async (query: string) => {
          const items: Row[] = [];
          let total = 0;
          for (let page = 1; ; page += 1) {
            const body = (
              await admin.client
                .get(`/api/admin/bookings?type=hotel&page=${page}${query}`)
                .expect(200)
            ).body as { items: Row[]; total: number };
            total = body.total;
            items.push(...body.items);
            if (items.length >= total || body.items.length === 0) break;
          }
          return { items, total };
        };

        const all = await list('&from=2029-05-01&to=2029-05-31');
        const row = all.items.find((r) => r.id === confirmed.id);
        expect(row).toMatchObject({
          reference: confirmed.reference,
          type: 'hotel',
          provider: { id: activeHotel.id, name: 'Nile View Hotel' },
          status: ReservationStatus.CONFIRMED,
          amount: confirmed.totalPrice,
          user: { id: guest.id },
        });
        expect(all.items.find((r) => r.id === pending.id)?.reference).toBe('');

        for (const status of ['Confirmed', 'CONFIRMED']) {
          const ids = (
            await list(`&status=${status}&from=2029-05-01&to=2029-05-31`)
          ).items.map((r) => r.id);
          expect(ids).toContain(confirmed.id);
          expect(ids).not.toContain(pending.id);
        }
        const pendingIds = (
          await list('&status=Pending%20Payment&from=2029-05-01&to=2029-05-31')
        ).items.map((r) => r.id);
        expect(pendingIds).toEqual([pending.id]);
        await admin.client
          .get('/api/admin/bookings?type=hotel&status=Booked')
          .expect(400);
        expect(
          (await list('&from=2029-05-02&to=2029-05-31')).items.map((r) => r.id),
        ).toEqual([pending.id]);
      });
    });

    describe('reservation queries for the hotels module', () => {
      it('takenRoomIds: Confirmed and live holds only, for the asked nights', async () => {
        const guest = await loggedInAs();
        const [confirmedRoom, heldRoom, expiredRoom, cancelledRoom, freeRoom] =
          [addRoom(), addRoom(), addRoom(), addRoom(), addRoom()];
        await confirmedAt(
          guest.client,
          [confirmedRoom],
          '2029-06-01',
          '2029-06-03',
        );
        await hold(
          guest.client,
          body([heldRoom], '2029-06-01', '2029-06-03'),
        ).expect(201);
        const expired = (
          await hold(
            guest.client,
            body([expiredRoom], '2029-06-01', '2029-06-03'),
          ).expect(201)
        ).body as HotelReservationView;
        await nights.updateMany(
          { reservation: expired.id },
          { holdExpiresAt: new Date(Date.now() - 1_000) },
        );
        const toCancel = await confirmedAt(
          guest.client,
          [cancelledRoom],
          '2029-06-01',
          '2029-06-03',
        );
        await guest.client
          .post(`/api/hotel-bookings/${toCancel.id}/cancel?confirm=true`)
          .expect(200);

        const all = [
          confirmedRoom,
          heldRoom,
          expiredRoom,
          cancelledRoom,
          freeRoom,
        ];
        expect(
          [
            ...(await queries.takenRoomIds(
              all,
              day('2029-06-02'),
              day('2029-06-05'),
            )),
          ].sort(),
        ).toEqual([confirmedRoom, heldRoom].sort());
        // The check-out day itself is free.
        expect(
          (
            await queries.takenRoomIds(
              all,
              day('2029-06-03'),
              day('2029-06-04'),
            )
          ).size,
        ).toBe(0);
      });

      it('roomActivity, wasEverReserved and hasUpcomingReservations', async () => {
        const guest = await loggedInAs();
        const room = addRoom();
        const never = addRoom();
        const stay = await confirmedAt(
          guest.client,
          [room],
          '2029-07-01',
          '2029-07-03',
        );

        expect(
          await queries.roomActivity(
            [room],
            day('2029-06-30'),
            day('2029-07-10'),
          ),
        ).toEqual([
          {
            roomId: room,
            night: '2029-07-01',
            reservationId: stay.id,
            reference: stay.reference,
            status: ReservationStatus.CONFIRMED,
          },
          expect.objectContaining({ night: '2029-07-02' }),
        ]);
        expect(await queries.wasEverReserved(room)).toBe(true);
        expect(await queries.wasEverReserved(never)).toBe(false);
        expect(await queries.hasUpcomingReservations(room)).toBe(true);
        expect(await queries.hasUpcomingReservations(never)).toBe(false);

        await guest.client
          .post(`/api/hotel-bookings/${stay.id}/cancel?confirm=true`)
          .expect(200);
        expect(await queries.hasUpcomingReservations(room)).toBe(false);
        // Deletion stays forbidden: it was reserved once (HTL-06).
        expect(await queries.wasEverReserved(room)).toBe(true);
      });

      it('forHotel: guest, dates and status for the moderator view (HTL-22)', async () => {
        const hotel: InventoryHotel = {
          id: new Types.ObjectId().toHexString(),
          name: 'Moderated Hotel',
          active: true,
          cancellationTiers: TIERS,
        };
        hotels.set(hotel.id, hotel);
        const a = await loggedInAs();
        const b = await loggedInAs();
        const room = (n: number) =>
          Array.from({ length: n }, () => addRoom({ hotelId: hotel.id }));
        const first = (
          await hold(
            a.client,
            body(room(2), '2029-08-01', '2029-08-02', { hotelId: hotel.id }),
          ).expect(201)
        ).body as HotelReservationView;
        await payments.confirmPaid(first.id, paid(first));
        const second = (
          await hold(
            b.client,
            body(room(1), '2029-08-05', '2029-08-06', { hotelId: hotel.id }),
          ).expect(201)
        ).body as HotelReservationView;
        await users.setStatus(b.id, UserStatus.DEACTIVATED);

        const page = await queries.forHotel(hotel.id, { page: 1, limit: 10 });
        expect(page.total).toBe(2);
        expect(page.items.map((r) => r.id)).toEqual([second.id, first.id]);
        expect(page.items[0].guest).toEqual({ id: null, name: 'Deleted user' });
        expect(page.items[1]).toMatchObject({
          guest: { id: a.id },
          checkIn: '2029-08-01',
          checkOut: '2029-08-02',
          status: ReservationStatus.CONFIRMED,
        });
        expect(page.items[1].rooms).toHaveLength(2);

        const confirmedOnly = await queries.forHotel(hotel.id, {
          page: 1,
          limit: 10,
          status: ReservationStatus.CONFIRMED,
        });
        expect(confirmedOnly.items.map((r) => r.id)).toEqual([first.id]);
        expect(
          (
            await queries.forHotel(activeHotel.id, { page: 1, limit: 10 })
          ).items.map((r) => r.id),
        ).not.toContain(first.id);
      });
    });
  });
  describe('Swagger (Milestone 1 is evaluated through it)', () => {
    it('documents every hotel booking and review endpoint with its requirement IDs', () => {
      const doc = SwaggerModule.createDocument(
        ctx.app,
        new DocumentBuilder().build(),
      );
      const expected: [string, string, string][] = [
        ['/api/hotel-bookings', 'post', 'HTL-16'],
        ['/api/hotel-bookings', 'get', 'HTL-20'],
        ['/api/hotel-bookings/{id}', 'get', 'HTL-17'],
        ['/api/hotel-bookings/{id}/cancellation', 'get', 'HTL-21'],
        ['/api/hotel-bookings/{id}/cancel', 'post', 'HTL-21'],
        ['/api/hotel-bookings/{id}/review', 'post', 'HTL-23'],
        ['/api/reviews/{id}', 'patch', 'HTL-23'],
        ['/api/reviews/{id}', 'delete', 'HTL-23'],
        ['/api/hotels/{id}/reviews', 'get', 'HTL-24'],
      ];
      for (const [path, method, id] of expected) {
        const operation = (
          doc.paths[path] as Record<string, { summary?: string }> | undefined
        )?.[method];
        expect(operation?.summary ?? `missing: ${method} ${path}`).toContain(
          id,
        );
      }
    });
  });
});
