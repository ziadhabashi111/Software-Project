import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { HotelReservationQueries } from '../src/hotel-bookings/hotel-reservation-queries';
import { formatDate } from '../src/hotel-bookings/stay-rules';
import { HotelCatalog } from '../src/hotels/hotel-catalog';
import { HotelsModule } from '../src/hotels/hotels.module';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 3]);

interface ErrorBody {
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface RangeView {
  id: string;
  from: string;
  to: string;
}

interface HotelBody {
  id: string;
  name: string;
  isActive: boolean;
  starClass: number;
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: { daysBefore: number; refundPercent: number }[];
  rating: { averageRating: number | null; ratingCount: number };
}

interface RoomBody {
  id: string;
  name: string;
  pricePerNight: number;
  isActive: boolean;
  availability: RangeView[];
  blocked: RangeView[];
}

interface AvailabilityBody {
  rooms: {
    roomId: string;
    nights: {
      date: string;
      status: string;
      reference?: string | null;
      reservationId?: string;
      reason?: string;
    }[];
  }[];
}

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);
const codeOf = (res: request.Response): string | undefined =>
  (res.body as ErrorBody).code;

type Agent = ReturnType<typeof request.agent>;

/** A calendar date `offset` days from today, so the tests never go stale. */
const day = (offset: number): string =>
  formatDate(new Date(Date.now() + offset * 86_400_000));

describe('Hotel catalogue: profile, rooms, availability and booking (HTL-01..10; real MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let dir: string;
  let users: UsersService;
  let passwords: PasswordService;
  let counter = 0;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hotel-photos-e2e-'));
    process.env.UPLOAD_DIR = dir;
    process.env.UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads';
    ctx = await createTestApp({
      replSet: true,
      extraModules: [AuditModule, AdminModule, HotelsModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
    delete process.env.UPLOAD_DIR;
    delete process.env.UPLOAD_PUBLIC_URL;
    await rm(dir, { recursive: true, force: true });
  });

  async function loggedInAs(
    role: Role = Role.USER,
    providerId?: string,
  ): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `hotel${counter}@example.com`;
    const doc = await users.create({
      name: `Hotel Person ${counter}`,
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

  const guest = () => request(ctx.server);

  async function createHotel(
    admin: { client: Agent },
    overrides: Record<string, unknown> = {},
  ): Promise<HotelBody> {
    return (
      await admin.client
        .post('/api/hotels')
        .send({
          name: 'Nile View Hotel',
          address: '12 Corniche El Nil',
          city: 'cairo',
          country: 'EG',
          starClass: 4,
          amenities: ['wifi', 'pool'],
          ...overrides,
        })
        .expect(201)
    ).body as HotelBody;
  }

  /** A hotel with its own moderator, ready to manage rooms. */
  async function hotelWithModerator() {
    const admin = await loggedInAs(Role.ADMIN);
    const hotel = await createHotel(admin);
    const moderator = await loggedInAs(Role.HOTEL_MODERATOR, hotel.id);
    return { admin, hotel, moderator };
  }

  describe('the hotel profile (HTL-01, HTL-02, HTL-09)', () => {
    it('lets an admin create a hotel that everyone can read, with the standard times and no rating yet', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const created = await createHotel(admin);
      expect(created).toMatchObject({
        name: 'Nile View Hotel',
        starClass: 4,
        isActive: true,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationPolicy: [],
        rating: { averageRating: null, ratingCount: 0 },
      });
      const seen = (await guest().get(`/api/hotels/${created.id}`).expect(200))
        .body as HotelBody;
      expect(seen.id).toBe(created.id);
    });

    it('is for admins only, and validates every field', async () => {
      const traveller = await loggedInAs();
      const { moderator } = await hotelWithModerator();
      const admin = await loggedInAs(Role.ADMIN);
      const valid = {
        name: 'X Hotel',
        address: '1 Road',
        city: 'cairo',
        country: 'EG',
        starClass: 3,
      };
      await guest().post('/api/hotels').send(valid).expect(401);
      await traveller.client.post('/api/hotels').send(valid).expect(403);
      await moderator.client.post('/api/hotels').send(valid).expect(403);

      for (const [change, field] of [
        [{ starClass: 6 }, 'starClass'],
        [{ starClass: 0 }, 'starClass'],
        [{ name: 'X' }, 'name'],
        [{ country: 'egypt' }, 'country'],
        [{ city: 'Not A City!' }, 'city'],
        [{ amenities: ['wifi', 'wifi'] }, 'amenities'],
      ] as [Record<string, unknown>, string][]) {
        const res = await admin.client
          .post('/api/hotels')
          .send({ ...valid, ...change })
          .expect(400);
        expect(fieldsOf(res)).toContain(field);
      }
    });

    it('answers 404 for an unknown or malformed hotel id', async () => {
      await guest().get('/api/hotels/665f1c2a9b1e8a0012345670').expect(404);
      await guest().get('/api/hotels/not-an-id').expect(404);
    });

    it('lets the hotel’s own moderator edit it, and nobody else', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const other = await hotelWithModerator();

      const edited = (
        await moderator.client
          .patch(`/api/hotels/${hotel.id}`)
          .send({ description: 'On the Nile', starClass: 5 })
          .expect(200)
      ).body as HotelBody;
      expect(edited).toMatchObject({ starClass: 5, name: 'Nile View Hotel' });

      await other.moderator.client
        .patch(`/api/hotels/${hotel.id}`)
        .send({ starClass: 1 })
        .expect(403);
      await other.admin.client
        .patch(`/api/hotels/${hotel.id}`)
        .send({ starClass: 1 })
        .expect(403);
      await moderator.client
        .patch(`/api/hotels/${hotel.id}`)
        .send({})
        .expect(400);
      expect(
        (
          (await guest().get(`/api/hotels/${hotel.id}`).expect(200))
            .body as HotelBody
        ).starClass,
      ).toBe(5);
    });
  });

  describe('check-in/out times and cancellation tiers (HTL-09, HTL-10)', () => {
    it('stores them, shows the tiers longest notice first, and rejects bad input', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const other = await hotelWithModerator();

      const view = (
        await moderator.client
          .put(`/api/hotels/${hotel.id}/policies`)
          .send({
            checkInTime: '15:00',
            checkOutTime: '11:00',
            tiers: [
              { daysBefore: 3, refundPercent: 50 },
              { daysBefore: 14, refundPercent: 100 },
              { daysBefore: 0, refundPercent: 0 },
            ],
          })
          .expect(200)
      ).body as HotelBody;
      expect(view).toMatchObject({
        checkInTime: '15:00',
        checkOutTime: '11:00',
      });
      expect(view.cancellationPolicy.map((t) => t.daysBefore)).toEqual([
        14, 3, 0,
      ]);

      const dup = await moderator.client
        .put(`/api/hotels/${hotel.id}/policies`)
        .send({
          tiers: [
            { daysBefore: 7, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
          ],
        })
        .expect(400);
      expect(fieldsOf(dup).join()).toContain('tiers');
      for (const bad of [
        { checkInTime: '25:00' },
        { tiers: [{ daysBefore: -1, refundPercent: 10 }] },
        { tiers: [{ daysBefore: 2, refundPercent: 101 }] },
        {},
      ]) {
        await moderator.client
          .put(`/api/hotels/${hotel.id}/policies`)
          .send(bad)
          .expect(400);
      }
      await other.moderator.client
        .put(`/api/hotels/${hotel.id}/policies`)
        .send({ checkInTime: '16:00' })
        .expect(403);

      // The earlier valid policy is untouched by the rejected requests.
      const kept = (await guest().get(`/api/hotels/${hotel.id}`).expect(200))
        .body as HotelBody;
      expect(kept.cancellationPolicy.map((t) => t.daysBefore)).toEqual([
        14, 3, 0,
      ]);
    });
  });

  describe('the admin side (ACC-13, ACC-15)', () => {
    it('links a hotel moderator only to a hotel that exists', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const hotel = await createHotel(admin);
      const moderator = (providerId: string, email: string) =>
        admin.client.post('/api/admin/moderators').send({
          name: 'Hotel Moderator',
          email,
          role: 'hotel_moderator',
          providerId,
          temporaryPassword: 'Temp1234pass',
        });

      const missing = await moderator(
        '665f1c2a9b1e8a0012345670',
        'ghost-hotel@example.com',
      ).expect(400);
      expect(fieldsOf(missing)).toContain('providerId');
      await moderator(hotel.id, 'real-hotel@example.com').expect(201);
    });

    it('hides a deactivated hotel from the public, but not from admins and its moderator, and restores it', async () => {
      const { admin, hotel, moderator } = await hotelWithModerator();

      await admin.client
        .patch(`/api/admin/providers/hotel/${hotel.id}/deactivate`)
        .expect(200);
      await guest().get(`/api/hotels/${hotel.id}`).expect(404);
      expect(
        (
          (await admin.client.get(`/api/hotels/${hotel.id}`).expect(200))
            .body as HotelBody
        ).isActive,
      ).toBe(false);
      await moderator.client.get(`/api/hotels/${hotel.id}`).expect(200);

      await admin.client
        .patch(`/api/admin/providers/hotel/${hotel.id}/reactivate`)
        .expect(200);
      await guest().get(`/api/hotels/${hotel.id}`).expect(200);
    });
  });

  describe('rooms and availability (HTL-03, HTL-04, HTL-05)', () => {
    const newRoom = (
      moderator: { client: Agent },
      hotelId: string,
      overrides: Record<string, unknown> = {},
    ) =>
      moderator.client.post(`/api/hotels/${hotelId}/rooms`).send({
        name: '101',
        type: 'Double',
        beds: 2,
        maxOccupancy: 3,
        pricePerNight: 100,
        ...overrides,
      });

    it('adds rooms with a number or name that is unique within the hotel', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const room = (await newRoom(moderator, hotel.id).expect(201))
        .body as RoomBody;
      expect(room).toMatchObject({
        name: '101',
        pricePerNight: 100,
        isActive: true,
        availability: [],
        blocked: [],
      });

      const dup = await newRoom(moderator, hotel.id).expect(409);
      expect(fieldsOf(dup)).toContain('name');
      await newRoom(moderator, hotel.id, { name: '102' }).expect(201);

      // The same number in another hotel is fine.
      const other = await hotelWithModerator();
      await newRoom(other.moderator, other.hotel.id).expect(201);

      const list = (
        await moderator.client.get(`/api/hotels/${hotel.id}/rooms`).expect(200)
      ).body as { items: RoomBody[] };
      expect(list.items.map((r) => r.name)).toEqual(['101', '102']);
    });

    it('lists rooms and the per-room status view 10 rooms per page (GEN-05, HTL-03, HTL-08)', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      for (let i = 1; i <= 12; i += 1) {
        await newRoom(moderator, hotel.id, {
          name: `R${String(i).padStart(2, '0')}`,
        }).expect(201);
      }
      const first = (
        await moderator.client.get(`/api/hotels/${hotel.id}/rooms`).expect(200)
      ).body as {
        items: RoomBody[];
        total: number;
        page: number;
        limit: number;
      };
      expect(first).toMatchObject({ total: 12, page: 1, limit: 10 });
      expect(first.items).toHaveLength(10);
      const second = (
        await moderator.client
          .get(`/api/hotels/${hotel.id}/rooms?page=2`)
          .expect(200)
      ).body as { items: RoomBody[] };
      expect(second.items.map((r) => r.name)).toEqual(['R11', 'R12']);

      const view = (
        await moderator.client
          .get(
            `/api/hotels/${hotel.id}/availability?from=${day(10)}&to=${day(11)}&page=2`,
          )
          .expect(200)
      ).body as AvailabilityBody & { total: number; page: number };
      expect(view).toMatchObject({ total: 12, page: 2, limit: 10 });
      expect(view.rooms).toHaveLength(2);
    });

    it('validates a room and keeps other moderators out', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const other = await hotelWithModerator();
      for (const [change, field] of [
        [{ maxOccupancy: 0 }, 'maxOccupancy'],
        [{ pricePerNight: 0 }, 'pricePerNight'],
        [{ pricePerNight: -5 }, 'pricePerNight'],
        [{ beds: 0 }, 'beds'],
        [{ name: '' }, 'name'],
      ] as [Record<string, unknown>, string][]) {
        const res = await newRoom(moderator, hotel.id, change).expect(400);
        expect(fieldsOf(res)).toContain(field);
      }
      await newRoom(other.moderator, hotel.id).expect(403);
      await other.moderator.client
        .get(`/api/hotels/${hotel.id}/rooms`)
        .expect(403);
      await guest().post(`/api/hotels/${hotel.id}/rooms`).send({}).expect(401);
    });

    it('edits beds, occupancy and price, but not the room across hotels', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const other = await hotelWithModerator();
      const room = (await newRoom(moderator, hotel.id).expect(201))
        .body as RoomBody;

      const edited = (
        await moderator.client
          .patch(`/api/hotels/${hotel.id}/rooms/${room.id}`)
          .send({ pricePerNight: 150, beds: 3 })
          .expect(200)
      ).body as RoomBody;
      expect(edited.pricePerNight).toBe(150);
      await moderator.client
        .patch(`/api/hotels/${hotel.id}/rooms/${room.id}`)
        .send({ pricePerNight: -1 })
        .expect(400);
      await moderator.client
        .patch(`/api/hotels/${hotel.id}/rooms/${room.id}`)
        .send({})
        .expect(400);
      // A room id from another hotel is not found in this one.
      await other.moderator.client
        .patch(`/api/hotels/${other.hotel.id}/rooms/${room.id}`)
        .send({ beds: 1 })
        .expect(404);
    });

    it('keeps availability ranges apart, and rejects dates that do not exist', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const room = (await newRoom(moderator, hotel.id).expect(201))
        .body as RoomBody;
      const url = `/api/hotels/${hotel.id}/rooms/${room.id}/availability`;

      const first = (
        await moderator.client
          .post(url)
          .send({ from: day(10), to: day(20) })
          .expect(201)
      ).body as RoomBody;
      expect(first.availability).toHaveLength(1);

      const clash = await moderator.client
        .post(url)
        .send({ from: day(20), to: day(30) })
        .expect(400);
      expect(fieldsOf(clash)).toContain('from');
      await moderator.client
        .post(url)
        .send({ from: day(21), to: day(30) })
        .expect(201);
      await moderator.client
        .post(url)
        .send({ from: '2027-02-30', to: '2027-03-10' })
        .expect(400);
      await moderator.client
        .post(url)
        .send({ from: day(50), to: day(40) })
        .expect(400);
    });

    it('never lets parallel requests leave overlapping ranges', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const room = (await newRoom(moderator, hotel.id).expect(201))
        .body as RoomBody;
      const url = `/api/hotels/${hotel.id}/rooms/${room.id}/availability`;

      const results = await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          moderator.client
            .post(url)
            .send({ from: day(10 + i), to: day(30 + i) }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      results
        .filter((r) => r.status !== 201)
        .forEach((r) => expect(r.status).toBe(400));
      const [finalRoom] = (
        (
          await moderator.client
            .get(`/api/hotels/${hotel.id}/rooms`)
            .expect(200)
        ).body as { items: RoomBody[] }
      ).items;
      expect(finalRoom.availability).toHaveLength(1);
    });

    it('moves and removes ranges while no reservation holds their nights', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const room = (await newRoom(moderator, hotel.id).expect(201))
        .body as RoomBody;
      const base = `/api/hotels/${hotel.id}/rooms/${room.id}/availability`;
      const added = (
        await moderator.client
          .post(base)
          .send({ from: day(10), to: day(20) })
          .expect(201)
      ).body as RoomBody;
      const rangeId = added.availability[0].id;

      const moved = (
        await moderator.client
          .patch(`${base}/${rangeId}`)
          .send({ from: day(12), to: day(40) })
          .expect(200)
      ).body as RoomBody;
      expect(moved.availability[0]).toMatchObject({
        from: day(12),
        to: day(40),
      });

      const removed = (
        await moderator.client.delete(`${base}/${rangeId}`).expect(200)
      ).body as RoomBody;
      expect(removed.availability).toEqual([]);
      await moderator.client.delete(`${base}/${rangeId}`).expect(404);
    });
  });

  describe('booking through the catalogue, and the reservation rules (HTL-06, HTL-08, HTL-16, HTL-18)', () => {
    async function ready() {
      const { admin, hotel, moderator } = await hotelWithModerator();
      const room = (
        await moderator.client
          .post(`/api/hotels/${hotel.id}/rooms`)
          .send({ name: '101', beds: 2, maxOccupancy: 3, pricePerNight: 100 })
          .expect(201)
      ).body as RoomBody;
      const base = `/api/hotels/${hotel.id}/rooms/${room.id}`;
      const range = (
        await moderator.client
          .post(`${base}/availability`)
          .send({ from: day(10), to: day(60) })
          .expect(201)
      ).body as RoomBody;
      const traveller = await loggedInAs();
      const hold = (from: number, to: number, who = traveller) =>
        who.client.post('/api/hotel-bookings').send({
          hotelId: hotel.id,
          checkIn: day(from),
          checkOut: day(to),
          rooms: [{ roomId: room.id, adults: 2, childrenAges: [] }],
        });
      return {
        admin,
        hotel,
        moderator,
        room,
        base,
        rangeId: range.availability[0].id,
        traveller,
        hold,
      };
    }

    it('holds a room for dates inside its availability, priced from the catalogue', async () => {
      const { hold, hotel } = await ready();
      const res = await hold(20, 23).expect(201);
      expect(res.body).toMatchObject({
        status: 'PENDING_PAYMENT',
        nights: 3,
        totalPrice: 300,
        hotel: { id: hotel.id, name: 'Nile View Hotel' },
      });
    });

    it('refuses dates outside the availability, and a second hold on the same nights', async () => {
      const { hold } = await ready();
      const outside = await hold(5, 8).expect(400);
      expect(codeOf(outside)).toBe('ROOM_NOT_AVAILABLE');
      await hold(20, 23).expect(201);
      const taken = await hold(22, 25).expect(409);
      expect(codeOf(taken)).toBe('ROOMS_UNAVAILABLE');
    });

    it('does not book a deactivated hotel or a deactivated room', async () => {
      const { admin, hotel, moderator, base, hold } = await ready();
      await moderator.client.patch(`${base}/deactivate`).expect(200);
      await hold(20, 23).expect(400);
      await moderator.client.patch(`${base}/reactivate`).expect(200);
      await hold(20, 23).expect(201);
      await admin.client
        .patch(`/api/admin/providers/hotel/${hotel.id}/deactivate`)
        .expect(200);
      await hold(30, 33).expect(404);
    });

    it('replaces all availability ranges at PATCH .../availability, keeping reserved nights (HTL-05, HTL-06)', async () => {
      const { moderator, base, hold } = await ready();
      await hold(20, 23).expect(201); // nights day(20), day(21), day(22)

      const replaced = (
        await moderator.client
          .patch(`${base}/availability`)
          .send({
            ranges: [
              { from: day(15), to: day(25) },
              { from: day(30), to: day(40) },
            ],
          })
          .expect(200)
      ).body as RoomBody;
      expect(
        replaced.availability.map(({ from, to }) => ({ from, to })),
      ).toEqual([
        { from: day(15), to: day(25) },
        { from: day(30), to: day(40) },
      ]);

      const overlap = await moderator.client
        .patch(`${base}/availability`)
        .send({
          ranges: [
            { from: day(15), to: day(25) },
            { from: day(25), to: day(30) },
          ],
        })
        .expect(400);
      expect(fieldsOf(overlap).length).toBeGreaterThan(0);

      const dropsHeld = await moderator.client
        .patch(`${base}/availability`)
        .send({ ranges: [{ from: day(22), to: day(40) }] })
        .expect(409);
      expect(codeOf(dropsHeld)).toBe('AVAILABILITY_IN_USE');

      const other = await hotelWithModerator();
      await other.moderator.client
        .patch(`${base}/availability`)
        .send({ ranges: [] })
        .expect(403);
    });

    it('refuses to block, shorten, remove, deactivate or delete over a reservation, and allows the harmless ones', async () => {
      const { moderator, base, rangeId, hold } = await ready();
      await hold(20, 23).expect(201); // nights day(20), day(21), day(22)

      const block = await moderator.client
        .post(`${base}/blocks`)
        .send({ from: day(21), to: day(21) })
        .expect(409);
      expect(codeOf(block)).toBe('ROOM_RESERVED');

      const shrink = await moderator.client
        .patch(`${base}/availability/${rangeId}`)
        .send({ from: day(10), to: day(21) })
        .expect(409);
      expect(codeOf(shrink)).toBe('AVAILABILITY_IN_USE');
      const remove = await moderator.client
        .delete(`${base}/availability/${rangeId}`)
        .expect(409);
      expect(codeOf(remove)).toBe('AVAILABILITY_IN_USE');

      expect(
        codeOf(await moderator.client.patch(`${base}/deactivate`).expect(409)),
      ).toBe('ROOM_RESERVED');
      expect(codeOf(await moderator.client.delete(base).expect(409))).toBe(
        'ROOM_HAS_RESERVATIONS',
      );

      // Nights nobody holds can still be blocked, and a range can still shrink past them.
      const blocked = (
        await moderator.client
          .post(`${base}/blocks`)
          .send({ from: day(40), to: day(41) })
          .expect(201)
      ).body as RoomBody;
      await moderator.client
        .delete(`${base}/blocks/${blocked.blocked[0].id}`)
        .expect(200);
      const shorter = (
        await moderator.client
          .patch(`${base}/availability/${rangeId}`)
          .send({ from: day(10), to: day(30) })
          .expect(200)
      ).body as RoomBody;
      expect(shorter.availability[0].to).toBe(day(30));
    });

    it('a blocked night cannot be booked, and a room nobody reserved can be deleted', async () => {
      const { moderator, base, hold, hotel } = await ready();
      await moderator.client
        .post(`${base}/blocks`)
        .send({ from: day(30), to: day(30) })
        .expect(201);
      const res = await hold(29, 32).expect(400);
      expect(codeOf(res)).toBe('ROOM_NOT_AVAILABLE');
      await hold(35, 37).expect(201); // a different stay is fine

      const spare = (
        await moderator.client
          .post(`/api/hotels/${hotel.id}/rooms`)
          .send({ name: '999', beds: 1, maxOccupancy: 1, pricePerNight: 50 })
          .expect(201)
      ).body as RoomBody;
      await moderator.client
        .delete(`/api/hotels/${hotel.id}/rooms/${spare.id}`)
        .expect(204);
      await moderator.client
        .delete(`/api/hotels/${hotel.id}/rooms/${spare.id}`)
        .expect(404);
    });

    it('shows each room night as Available, Booked (reference null while unpaid) or Blocked', async () => {
      const { moderator, base, hold, hotel } = await ready();
      const reservation = (await hold(20, 22).expect(201)).body as {
        id: string;
        reference: string | null;
      };
      await moderator.client
        .post(`${base}/blocks`)
        .send({ from: day(23), to: day(23) })
        .expect(201);

      const view = (
        await moderator.client
          .get(
            `/api/hotels/${hotel.id}/availability?from=${day(19)}&to=${day(24)}`,
          )
          .expect(200)
      ).body as AvailabilityBody;
      const nights = Object.fromEntries(
        view.rooms[0].nights.map((n) => [n.date, n]),
      );
      expect(nights[day(19)]).toEqual({ date: day(19), status: 'Available' });
      expect(nights[day(20)]).toMatchObject({
        status: 'Booked',
        reference: null,
        reservationId: reservation.id,
      });
      expect(nights[day(21)].status).toBe('Booked');
      expect(nights[day(22)]).toEqual({ date: day(22), status: 'Available' });
      expect(nights[day(23)]).toEqual({
        date: day(23),
        status: 'Blocked',
        reason: 'BLOCKED',
      });
    });

    it('shows the room status only to the hotel’s own moderator, for a sensible period', async () => {
      const { moderator, hotel } = await ready();
      const other = await hotelWithModerator();
      const url = `/api/hotels/${hotel.id}/availability`;
      await other.moderator.client
        .get(`${url}?from=${day(1)}&to=${day(5)}`)
        .expect(403);
      await moderator.client
        .get(`${url}?from=${day(1)}&to=${day(200)}`)
        .expect(400);
      await moderator.client
        .get(`${url}?from=${day(5)}&to=${day(1)}`)
        .expect(400);
      await moderator.client.get(`${url}?from=oops&to=${day(1)}`).expect(400);
    });
  });
  describe('moderator changes and guest holds never interleave (HTL-05, HTL-06, HTL-18)', () => {
    async function ready() {
      const { hotel, moderator } = await hotelWithModerator();
      const room = (
        await moderator.client
          .post(`/api/hotels/${hotel.id}/rooms`)
          .send({ name: '201', beds: 2, maxOccupancy: 3, pricePerNight: 100 })
          .expect(201)
      ).body as RoomBody;
      const base = `/api/hotels/${hotel.id}/rooms/${room.id}`;
      await moderator.client
        .post(`${base}/availability`)
        .send({ from: day(10), to: day(60) })
        .expect(201);
      const traveller = await loggedInAs();
      const hold = () =>
        traveller.client.post('/api/hotel-bookings').send({
          hotelId: hotel.id,
          checkIn: day(20),
          checkOut: day(23),
          rooms: [{ roomId: room.id, adults: 2, childrenAges: [] }],
        });
      return { moderator, base, hold };
    }

    it('a hold made after the block checked for reservations, but before it saved, wins and the block is refused', async () => {
      const { moderator, base, hold } = await ready();
      const queries = ctx.moduleRef.get(HotelReservationQueries);
      const original = queries.takenRoomIds.bind(queries);
      let held: request.Response | undefined;
      const spy = jest
        .spyOn(queries, 'takenRoomIds')
        .mockImplementationOnce(async (...args) => {
          const result = await original(...args);
          held = await hold();
          return result;
        });
      try {
        const block = await moderator.client
          .post(`${base}/blocks`)
          .send({ from: day(21), to: day(21) });
        expect(held?.status).toBe(201);
        expect(block.status).toBe(409);
        expect(codeOf(block)).toBe('ROOM_RESERVED');
      } finally {
        spy.mockRestore();
      }
    });

    it('a block saved after the hold read the room, but before the hold was stored, makes the hold fail', async () => {
      const { moderator, base, hold } = await ready();
      const catalog = ctx.moduleRef.get(HotelCatalog);
      const original = catalog.findRooms.bind(catalog);
      let blocked: request.Response | undefined;
      const spy = jest
        .spyOn(catalog, 'findRooms')
        .mockImplementationOnce(async (...args) => {
          const result = await original(...args);
          blocked = await moderator.client
            .post(`${base}/blocks`)
            .send({ from: day(21), to: day(21) });
          return result;
        });
      try {
        const res = await hold();
        expect(blocked?.status).toBe(201);
        expect(res.status).toBe(400);
        expect(codeOf(res)).toBe('ROOM_NOT_AVAILABLE');
      } finally {
        spy.mockRestore();
      }
    });

    it('a room is never deleted under a hold made after the delete checked it', async () => {
      const { moderator, base, hold } = await ready();
      const queries = ctx.moduleRef.get(HotelReservationQueries);
      const original = queries.wasEverReserved.bind(queries);
      let held: request.Response | undefined;
      const spy = jest
        .spyOn(queries, 'wasEverReserved')
        .mockImplementationOnce(async (...args) => {
          const result = await original(...args);
          held = await hold();
          return result;
        });
      try {
        const removed = await moderator.client.delete(base);
        expect(held?.status).toBe(201);
        expect(removed.status).toBe(409);
        expect(codeOf(removed)).toBe('ROOM_HAS_RESERVATIONS');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('hotel photos (HTL-01, GEN-08)', () => {
    const upload = (client: Agent, hotelId: string, count = 1) => {
      const req = client.post(`/api/hotels/${hotelId}/images`);
      for (let i = 0; i < count; i += 1) req.attach('images', PNG, `p${i}.png`);
      return req;
    };

    it('lets the hotel’s moderator add and remove photos, and deletes the file with the photo', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const before = (await readdir(dir)).length;

      const added = (await upload(moderator.client, hotel.id, 2).expect(201))
        .body as HotelBody & { photos: { id: string; url: string }[] };
      expect(added.photos).toHaveLength(2);
      expect((await readdir(dir)).length).toBe(before + 2);
      const seen = (await guest().get(`/api/hotels/${hotel.id}`).expect(200))
        .body as typeof added;
      expect(seen.photos.map((p) => p.url)).toEqual(
        added.photos.map((p) => p.url),
      );

      const removed = (
        await moderator.client
          .delete(`/api/hotels/${hotel.id}/images/${added.photos[0].id}`)
          .expect(200)
      ).body as typeof added;
      expect(removed.photos.map((p) => p.id)).toEqual([added.photos[1].id]);
      expect((await readdir(dir)).length).toBe(before + 1);
      await moderator.client
        .delete(`/api/hotels/${hotel.id}/images/${added.photos[0].id}`)
        .expect(404);
    });

    it('deletes the file when another moderator of the same hotel removes the photo', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const colleague = await loggedInAs(Role.HOTEL_MODERATOR, hotel.id);
      const added = (await upload(moderator.client, hotel.id).expect(201))
        .body as { photos: { id: string; url: string }[] };
      const name = added.photos[0].url.split('/').pop() as string;
      expect(await readdir(dir)).toContain(name);

      await colleague.client
        .delete(`/api/hotels/${hotel.id}/images/${added.photos[0].id}`)
        .expect(200);
      expect(await readdir(dir)).not.toContain(name);
      await guest().get(`/uploads/${name}`).expect(404);
    });

    it('keeps everyone else out, and stores nothing for them', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const other = await hotelWithModerator();
      const traveller = await loggedInAs();
      const before = (await readdir(dir)).length;

      await upload(other.moderator.client, hotel.id).expect(403);
      await upload(other.admin.client, hotel.id).expect(403);
      await upload(traveller.client, hotel.id).expect(403);
      await guest()
        .post(`/api/hotels/${hotel.id}/images`)
        .attach('images', PNG, 'p.png')
        .expect(401);
      expect((await readdir(dir)).length).toBe(before);

      const photo = (await upload(moderator.client, hotel.id).expect(201))
        .body as {
        photos: { id: string }[];
      };
      await other.moderator.client
        .delete(`/api/hotels/${hotel.id}/images/${photo.photos[0].id}`)
        .expect(403);
    });

    it('accepts only real JPG/PNG files, at most 5 per hotel, and never exceeds that in parallel', async () => {
      const { hotel, moderator } = await hotelWithModerator();
      const fake = await moderator.client
        .post(`/api/hotels/${hotel.id}/images`)
        .attach('images', Buffer.from('<script>alert(1)</script>'), 'x.png')
        .expect(400);
      expect(fieldsOf(fake)).toContain('images');
      await moderator.client.post(`/api/hotels/${hotel.id}/images`).expect(400);

      await upload(moderator.client, hotel.id, 4).expect(201);
      const before = (await readdir(dir)).length;
      await upload(moderator.client, hotel.id, 2).expect(400);
      expect((await readdir(dir)).length).toBe(before);

      const racing = await Promise.all(
        [0, 1, 2].map(() => upload(moderator.client, hotel.id)),
      );
      expect(racing.filter((r) => r.status === 201)).toHaveLength(1);
      const final = (await guest().get(`/api/hotels/${hotel.id}`).expect(200))
        .body as { photos: unknown[] };
      expect(final.photos).toHaveLength(5);
      // The files of the refused uploads were deleted again.
      expect((await readdir(dir)).length).toBe(before + 1);
    });
  });
});
