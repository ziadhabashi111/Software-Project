import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { formatDate } from '../src/hotel-bookings/stay-rules';
import { HotelsModule } from '../src/hotels/hotels.module';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  errors?: { field: string; messages: string[] }[];
}

interface SearchBody {
  items: {
    id: string;
    name: string;
    pricePerNight: number;
    freeRooms: number;
    rating: { averageRating: number | null; ratingCount: number };
  }[];
  total: number;
  page: number;
  limit: number;
}

interface AvailableBody {
  hotelId: string;
  nights: number;
  rooms: {
    id: string;
    name: string;
    type: string | null;
    beds: number;
    maxOccupancy: number;
    pricePerNight: number;
    totalPrice: number;
  }[];
}

interface HotelRef {
  id: string;
  name: string;
  roomIds: string[];
  moderator: Agent;
  city: string;
  country: string;
}

type Agent = ReturnType<typeof request.agent>;

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

/** A calendar date `offset` days from today, so the tests never go stale. */
const day = (offset: number): string =>
  formatDate(new Date(Date.now() + offset * 86_400_000));

describe('Hotel search and free rooms (HTL-11, HTL-12, HTL-15; real MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let admin: Agent;
  let counter = 0;
  let place = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      replSet: true,
      extraModules: [AuditModule, AdminModule, HotelsModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    admin = await loggedInAs(Role.ADMIN);
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(
    role: Role = Role.USER,
    providerId?: string,
  ): Promise<Agent> {
    counter += 1;
    const email = `search${counter}@example.com`;
    await users.create({
      name: `Search Person ${counter}`,
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

  const guest = () => request(ctx.server);

  /** A city and country no other test uses, so tests never see each other's hotels. */
  function newPlace(): { city: string; country: string } {
    place += 1;
    return {
      city: `town-${place}`,
      country: `Q${String.fromCharCode(64 + place)}`,
    };
  }

  /** A hotel with its moderator and rooms, all open from day 5 to day 60. */
  async function hotelWith(
    where: { city: string; country: string },
    name: string,
    rooms: { name: string; price: number; occupancy?: number; beds?: number }[],
  ): Promise<HotelRef> {
    const hotel = (
      await admin
        .post('/api/hotels')
        .send({
          name,
          address: '1 Test Road',
          city: where.city,
          country: where.country,
          starClass: 3,
        })
        .expect(201)
    ).body as { id: string };
    const moderator = await loggedInAs(Role.HOTEL_MODERATOR, hotel.id);
    const roomIds: string[] = [];
    for (const room of rooms) {
      const created = (
        await moderator
          .post(`/api/hotels/${hotel.id}/rooms`)
          .send({
            name: room.name,
            type: 'Double',
            beds: room.beds ?? 2,
            maxOccupancy: room.occupancy ?? 2,
            pricePerNight: room.price,
          })
          .expect(201)
      ).body as { id: string };
      await moderator
        .post(`/api/hotels/${hotel.id}/rooms/${created.id}/availability`)
        .send({ from: day(5), to: day(60) })
        .expect(201);
      roomIds.push(created.id);
    }
    return { id: hotel.id, name, roomIds, moderator, ...where };
  }

  const stay = { checkIn: day(20), checkOut: day(23), guests: 2 };

  const search = (params: Record<string, string | number>) =>
    guest().get('/api/hotels/search').query(params);

  describe('GET /api/hotels/search (HTL-11)', () => {
    it('lists the hotels of a city with their cheapest free room, cheapest first', async () => {
      const where = newPlace();
      await hotelWith(where, 'Pricey', [
        { name: '1', price: 150 },
        { name: '2', price: 100 },
      ]);
      await hotelWith(where, 'Budget', [{ name: '1', price: 60 }]);

      const res = await search({ city: where.city, ...stay }).expect(200);
      const body = res.body as SearchBody;
      expect(body.total).toBe(2);
      expect(
        body.items.map((h) => [h.name, h.pricePerNight, h.freeRooms]),
      ).toEqual([
        ['Budget', 60, 1],
        ['Pricey', 100, 2],
      ]);
      expect(body.items[0].rating).toEqual({
        averageRating: null,
        ratingCount: 0,
      });
    });

    it('searches a whole country and hides a deactivated hotel', async () => {
      const where = newPlace();
      const open = await hotelWith(where, 'Open', [{ name: '1', price: 80 }]);
      const closed = await hotelWith(
        { city: `${where.city}-b`, country: where.country },
        'Closed',
        [{ name: '1', price: 70 }],
      );
      await admin
        .patch(`/api/admin/providers/hotel/${closed.id}/deactivate`)
        .expect(200);

      const res = await search({ country: where.country, ...stay }).expect(200);
      expect((res.body as SearchBody).items.map((h) => h.id)).toEqual([
        open.id,
      ]);
    });

    it('needs enough free rooms whose combined occupancy covers the guests', async () => {
      const where = newPlace();
      await hotelWith(where, 'Two rooms', [
        { name: '1', price: 100, occupancy: 2 },
        { name: '2', price: 100, occupancy: 4 },
      ]);
      await hotelWith(where, 'One room', [
        { name: '1', price: 50, occupancy: 2 },
      ]);

      const three = await search({
        city: where.city,
        ...stay,
        guests: 3,
        rooms: 2,
      }).expect(200);
      expect((three.body as SearchBody).items.map((h) => h.name)).toEqual([
        'Two rooms',
      ]);
      // The two rooms hold 2 + 4 = 6 guests at most, so seven guests fit nowhere.
      const seven = await search({
        city: where.city,
        ...stay,
        guests: 7,
        rooms: 2,
      }).expect(200);
      expect((seven.body as SearchBody).total).toBe(0);
    });

    // HTL-11: "free" means no Confirmed reservation or unexpired hold on any night.
    it('does not offer a room that an unpaid hold has taken, only for those dates', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Held', [{ name: '1', price: 90 }]);
      const traveller = await loggedInAs();
      await traveller
        .post('/api/hotel-bookings')
        .send({
          hotelId: hotel.id,
          checkIn: day(20),
          checkOut: day(22),
          rooms: [{ roomId: hotel.roomIds[0], adults: 2, childrenAges: [] }],
        })
        .expect(201);

      const during = await search({
        city: where.city,
        checkIn: day(21),
        checkOut: day(24),
        guests: 2,
      }).expect(200);
      expect((during.body as SearchBody).total).toBe(0);
      const after = await search({
        city: where.city,
        checkIn: day(22),
        checkOut: day(24),
        guests: 2,
      }).expect(200);
      expect((after.body as SearchBody).total).toBe(1);
    });

    it('does not offer a room with a blocked night inside the stay', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Blocked', [
        { name: '1', price: 90 },
      ]);
      await hotel.moderator
        .post(`/api/hotels/${hotel.id}/rooms/${hotel.roomIds[0]}/blocks`)
        .send({ from: day(30), to: day(30) })
        .expect(201);

      const blocked = await search({
        city: where.city,
        checkIn: day(29),
        checkOut: day(32),
        guests: 2,
      }).expect(200);
      expect((blocked.body as SearchBody).total).toBe(0);
      // Check-out on the blocked day is fine: that day is not a night.
      const endsOnBlock = await search({
        city: where.city,
        checkIn: day(28),
        checkOut: day(30),
        guests: 2,
      }).expect(200);
      expect((endsOnBlock.body as SearchBody).total).toBe(1);
    });
  });

  describe('filters, sorting and paging (HTL-12)', () => {
    async function threeHotels() {
      const where = newPlace();
      await hotelWith(where, 'Cheap', [{ name: '1', price: 60 }]);
      await hotelWith(where, 'Mid', [{ name: '1', price: 100 }]);
      await hotelWith(where, 'Dear', [{ name: '1', price: 150 }]);
      return where;
    }
    const names = (res: request.Response) =>
      (res.body as SearchBody).items.map((h) => h.name);

    it('filters by an inclusive price range', async () => {
      const where = await threeHotels();
      const base = { city: where.city, ...stay };
      expect(
        names(await search({ ...base, minPrice: 100 }).expect(200)),
      ).toEqual(['Mid', 'Dear']);
      expect(
        names(await search({ ...base, maxPrice: 100 }).expect(200)),
      ).toEqual(['Cheap', 'Mid']);
      expect(
        names(
          await search({ ...base, minPrice: 100, maxPrice: 100 }).expect(200),
        ),
      ).toEqual(['Mid']);
    });

    it('sorts by price in either direction', async () => {
      const where = await threeHotels();
      const res = await search({
        city: where.city,
        ...stay,
        sortBy: 'price',
        order: 'desc',
      }).expect(200);
      expect(names(res)).toEqual(['Dear', 'Mid', 'Cheap']);
    });

    // HTL-12: unrated hotels are excluded only when a rating filter is set.
    it('leaves out unrated hotels only when a minimum rating is set', async () => {
      const where = await threeHotels();
      const base = { city: where.city, ...stay };
      expect(
        (await search({ ...base, minRating: 1 }).expect(200)).body,
      ).toMatchObject({ total: 0 });
      const sorted = await search({ ...base, sortBy: 'rating' }).expect(200);
      expect((sorted.body as SearchBody).total).toBe(3);
    });

    it('pages the results', async () => {
      const where = await threeHotels();
      const res = await search({
        city: where.city,
        ...stay,
        limit: 1,
        page: 2,
      }).expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 2, limit: 1 });
      expect(names(res)).toEqual(['Mid']);
    });
  });

  describe('input rules (HTL-11)', () => {
    const base = { city: 'nowhere', ...stay };
    const cases: [
      string,
      Record<string, string | number | undefined>,
      string,
    ][] = [
      ['no city or country', { city: undefined }, 'city'],
      ['check-out not after check-in', { checkOut: stay.checkIn }, 'checkOut'],
      [
        'check-in in the past',
        { checkIn: day(-2), checkOut: day(1) },
        'checkIn',
      ],
      ['an impossible date', { checkIn: '2027-02-30' }, 'checkIn'],
      ['more rooms than guests', { guests: 1, rooms: 2 }, 'rooms'],
      ['no guests', { guests: 0 }, 'guests'],
      [
        'a minimum price above the maximum',
        { minPrice: 9, maxPrice: 3 },
        'minPrice',
      ],
      ['a rating above 5', { minRating: 6 }, 'minRating'],
      ['an unknown sort', { sortBy: 'colour' }, 'sortBy'],
      ['a stay over 30 nights', { checkOut: day(60) }, 'checkOut'],
      ['an unknown parameter', { colour: 'red' }, 'colour'],
    ];

    it.each(cases)('rejects %s', async (_label, change, field) => {
      const params = Object.fromEntries(
        Object.entries({ ...base, ...change }).filter(
          ([, v]) => v !== undefined,
        ),
      ) as Record<string, string | number>;
      const res = await search(params).expect(400);
      expect(fieldsOf(res)).toContain(field);
    });
  });

  describe('GET /api/hotels/:id/rooms/available (HTL-15)', () => {
    const dates = { checkIn: day(20), checkOut: day(23) };
    const available = (id: string, params: Record<string, string> = dates) =>
      guest().get(`/api/hotels/${id}/rooms/available`).query(params);

    it('lists the free rooms with the total stay price, cheapest first, for guests', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Rooms', [
        { name: '102', price: 150.5, beds: 3, occupancy: 3 },
        { name: '101', price: 80 },
      ]);
      const res = await available(hotel.id).expect(200);
      const body = res.body as AvailableBody;
      expect(body.nights).toBe(3);
      expect(
        body.rooms.map((r) => [r.name, r.pricePerNight, r.totalPrice]),
      ).toEqual([
        ['101', 80, 240],
        ['102', 150.5, 451.5],
      ]);
      expect(body.rooms[1]).toMatchObject({
        type: 'Double',
        beds: 3,
        maxOccupancy: 3,
      });
    });

    it('leaves out held and blocked rooms', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Mixed', [
        { name: 'held', price: 70 },
        { name: 'blocked', price: 80 },
        { name: 'free', price: 90 },
      ]);
      const traveller = await loggedInAs();
      await traveller
        .post('/api/hotel-bookings')
        .send({
          hotelId: hotel.id,
          checkIn: day(21),
          checkOut: day(22),
          rooms: [{ roomId: hotel.roomIds[0], adults: 1, childrenAges: [] }],
        })
        .expect(201);
      await hotel.moderator
        .post(`/api/hotels/${hotel.id}/rooms/${hotel.roomIds[1]}/blocks`)
        .send({ from: day(22), to: day(22) })
        .expect(201);

      const res = await available(hotel.id).expect(200);
      expect((res.body as AvailableBody).rooms.map((r) => r.name)).toEqual([
        'free',
      ]);
    });

    it('answers 404 for an unknown or malformed hotel id', async () => {
      await available('665f1c2a9b1e8a0012345670').expect(404);
      await available('not-an-id').expect(404);
    });

    it('hides a deactivated hotel from guests but not from admins or its moderator', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Off', [{ name: '1', price: 60 }]);
      await admin
        .patch(`/api/admin/providers/hotel/${hotel.id}/deactivate`)
        .expect(200);

      await available(hotel.id).expect(404);
      await admin
        .get(`/api/hotels/${hotel.id}/rooms/available`)
        .query(dates)
        .expect(200);
      await hotel.moderator
        .get(`/api/hotels/${hotel.id}/rooms/available`)
        .query(dates)
        .expect(200);
    });

    it('validates the dates', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Dates', [{ name: '1', price: 60 }]);
      const back = await available(hotel.id, {
        checkIn: day(23),
        checkOut: day(20),
      }).expect(400);
      expect(fieldsOf(back)).toContain('checkOut');
      const past = await available(hotel.id, {
        checkIn: day(-3),
        checkOut: day(-1),
      }).expect(400);
      expect(fieldsOf(past)).toContain('checkIn');
      await available(hotel.id, { checkIn: day(20) }).expect(400);
    });
  });

  describe('hotels from an itinerary (ITN-25)', () => {
    // The itinerary module reaches this search through HotelSearchHook; until the
    // hotels module registered it, this answered 503.
    it('finds hotels for the city of a day of my itinerary', async () => {
      const where = newPlace();
      const hotel = await hotelWith(where, 'Itinerary stop', [
        { name: '1', price: 75 },
      ]);
      const traveller = await loggedInAs();
      const itinerary = (
        await traveller
          .post('/api/itineraries')
          .send({ title: 'Trip', countries: ['EG'], startDate: day(10) })
          .expect(201)
      ).body as { id: string };
      await traveller
        .post(`/api/itineraries/${itinerary.id}/days`)
        .send({ city: where.city })
        .expect(201);

      const res = await traveller
        .get(`/api/itineraries/${itinerary.id}/hotels`)
        .query({ guests: 2 })
        .expect(200);
      const body = res.body as {
        search: { city: string; checkIn: string; checkOut: string };
        hotels: SearchBody;
      };
      expect(body.search).toMatchObject({
        city: where.city,
        checkIn: day(10),
        checkOut: day(11),
      });
      expect(body.hotels.items.map((h) => h.id)).toEqual([hotel.id]);
    });
  });
});
