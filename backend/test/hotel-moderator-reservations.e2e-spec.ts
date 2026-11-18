import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import type { Paginated } from '../src/common/pagination/pagination';
import { HotelBookingsModule } from '../src/hotel-bookings/hotel-bookings.module';
import type { HotelReservationRow } from '../src/hotel-bookings/hotel-reservation-queries';
import { ReservationStatus } from '../src/hotel-bookings/reservation-status';
import {
  HotelReservation,
  HotelReservationDocument,
} from '../src/hotel-bookings/schemas/hotel-reservation.schema';
import { HotelsModule } from '../src/hotels/hotels.module';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

describe('Hotel moderator reservations (HTL-22, ACC-11; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let reservations: Model<HotelReservationDocument>;
  let counter = 0;

  const hotelId = new Types.ObjectId().toHexString();
  const otherHotelId = new Types.ObjectId().toHexString();
  const emptyHotelId = new Types.ObjectId().toHexString();
  let guestId: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [
        AuditModule,
        AdminModule,
        HotelBookingsModule,
        HotelsModule,
      ],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    reservations = ctx.moduleRef.get(getModelToken(HotelReservation.name));

    const guest = await users.create({
      name: 'Ana Hassan',
      email: 'ana@example.com',
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.USER,
    });
    guestId = guest.id;
    // 12 reservations at our hotel (check-ins 2030-01-01 .. 2030-01-12), one elsewhere.
    for (let day = 1; day <= 12; day += 1) {
      await addReservation(hotelId, day);
    }
    await addReservation(otherHotelId, 20);
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function addReservation(hotel: string, day: number): Promise<void> {
    const dd = String(day).padStart(2, '0');
    const next = String(day + 1).padStart(2, '0');
    await reservations.create({
      reference: `HB-${hotel.slice(-4)}${dd}`,
      user: new Types.ObjectId(guestId),
      hotel: new Types.ObjectId(hotel),
      hotelName: 'Nile View Hotel',
      rooms: [
        {
          room: new Types.ObjectId(),
          name: '101',
          adults: 2,
          childrenAges: [7],
          pricePerNight: 120,
          subtotal: 120,
        },
      ],
      checkIn: new Date(`2030-01-${dd}T00:00:00.000Z`),
      checkOut: new Date(`2030-01-${next}T00:00:00.000Z`),
      nights: 1,
      totalPrice: 120,
      currency: 'USD',
      status: ReservationStatus.CONFIRMED,
      confirmedAt: new Date(),
    });
  }

  async function loggedInAs(role: Role, providerId?: string) {
    counter += 1;
    const email = `staff${counter}@example.com`;
    await users.create({
      name: `Staff ${counter}`,
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
    return client;
  }

  const url = (id: string) => `/api/hotels/${id}/reservations`;

  it('shows the hotel moderator their own hotel’s reservations: guest, dates, status', async () => {
    const client = await loggedInAs(Role.HOTEL_MODERATOR, hotelId);
    const res = await client.get(url(hotelId)).expect(200);
    const page = res.body as Paginated<HotelReservationRow>;

    expect(page.total).toBe(12);
    expect(page.page).toBe(1);
    expect(page.limit).toBe(10);
    expect(page.items).toHaveLength(10);
    // Latest check-in first.
    expect(page.items[0]).toMatchObject({
      guest: { id: guestId, name: 'Ana Hassan' },
      checkIn: '2030-01-12',
      checkOut: '2030-01-13',
      status: ReservationStatus.CONFIRMED,
      rooms: [{ name: '101', adults: 2, children: 1 }],
    });
    // No contact details or payment data are exposed.
    const keys = Object.keys(page.items[0]).sort();
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('payment');
    expect(JSON.stringify(page.items[0].guest)).not.toContain('@');
  });

  it('paginates', async () => {
    const client = await loggedInAs(Role.HOTEL_MODERATOR, hotelId);
    const res = await client
      .get(url(hotelId))
      .query({ page: 2, limit: 5 })
      .expect(200);
    const page = res.body as Paginated<HotelReservationRow>;
    expect(page).toMatchObject({ total: 12, page: 2, limit: 5 });
    expect(page.items.map((r) => r.checkIn)).toEqual([
      '2030-01-07',
      '2030-01-06',
      '2030-01-05',
      '2030-01-04',
      '2030-01-03',
    ]);
    const last = (await client.get(url(hotelId)).query({ page: 3, limit: 5 }))
      .body as Paginated<HotelReservationRow>;
    expect(last.items).toHaveLength(2);
  });

  it.each([[{ limit: 101 }], [{ limit: 0 }], [{ page: 0 }], [{ page: 'abc' }]])(
    'rejects invalid pagination %j with 400',
    async (query) => {
      const client = await loggedInAs(Role.HOTEL_MODERATOR, hotelId);
      await client.get(url(hotelId)).query(query).expect(400);
    },
  );

  it('answers an empty page for a hotel with no reservations', async () => {
    const client = await loggedInAs(Role.HOTEL_MODERATOR, emptyHotelId);
    const res = await client.get(url(emptyHotelId)).expect(200);
    expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 10 });
  });

  it('lets an admin see any hotel’s reservations', async () => {
    const client = await loggedInAs(Role.ADMIN);
    const res = await client.get(url(otherHotelId)).expect(200);
    const page = res.body as Paginated<HotelReservationRow>;
    expect(page.total).toBe(1);
    expect(page.items[0].checkIn).toBe('2030-01-20');
  });

  it('forbids the moderator of another hotel (403)', async () => {
    const client = await loggedInAs(Role.HOTEL_MODERATOR, otherHotelId);
    await client.get(url(hotelId)).expect(403);
  });

  it('forbids an airline moderator, even with the same provider id (403)', async () => {
    const client = await loggedInAs(Role.AIRLINE_MODERATOR, hotelId);
    await client.get(url(hotelId)).expect(403);
  });

  it('forbids a registered user (403)', async () => {
    const client = await loggedInAs(Role.USER);
    await client.get(url(hotelId)).expect(403);
  });

  it('needs a login (401)', async () => {
    await request(ctx.server).get(url(hotelId)).expect(401);
  });

  it('answers 404 for an id that is not a MongoDB id', async () => {
    const client = await loggedInAs(Role.ADMIN);
    await client.get(url('not-an-id')).expect(404);
  });

  it('is documented in Swagger with its requirement ID', () => {
    const doc = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const operation = (
      doc.paths['/api/hotels/{id}/reservations'] as
        Record<string, { summary?: string }> | undefined
    )?.get;
    expect(operation?.summary).toContain('HTL-22');
  });
});
