import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { CabinClass, FlightStatus } from '../src/flights/flight-status';
import { FlightsModule } from '../src/flights/flights.module';
import {
  Airline,
  AirlineDocument,
} from '../src/flights/schemas/airline.schema';
import {
  Airport,
  AirportDocument,
} from '../src/flights/schemas/airport.schema';
import { Flight, FlightDocument } from '../src/flights/schemas/flight.schema';
import { utcToLocal } from '../src/flights/time-zones';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

jest.setTimeout(60_000);

const PASSWORD = 'Passw0rdOk';
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface ErrorBody {
  statusCode: number;
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface FlightBody {
  id: string;
  flightNumber: string;
  status: string;
  departure: { localDate: string; localTime: string; utcOffset: string };
  arrival: { localDate: string; localTime: string; utcOffset: string };
  durationMinutes: number;
  cabins: {
    id: string;
    cabinClass: string;
    price: number;
    totalSeats: number;
    seatsRemaining: number;
  }[];
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface SearchBody {
  outbound: Page<FlightBody & { fromPrice: number }>;
  return: Page<FlightBody> | null;
  message: string | null;
}

describe('Flights (FLT-01..30; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let flights: Model<FlightDocument>;
  let airlines: Model<AirlineDocument>;
  let airline: AirlineDocument;
  let otherAirline: AirlineDocument;
  let userCounter = 0;
  let flightCounter = 0;
  /** Each search test uses its own date so tests never see each other's flights. */
  let dateCounter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, FlightsModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    flights = ctx.moduleRef.get(getModelToken(Flight.name));
    airlines = ctx.moduleRef.get(getModelToken(Airline.name));
    const airports: Model<AirportDocument> = ctx.moduleRef.get(
      getModelToken(Airport.name),
    );
    // The unique flight-number index is part of what is tested.
    await flights.syncIndexes();
    await airports.syncIndexes();

    // Inserted directly: the seed script is another teammate's issue.
    await airports.insertMany([
      {
        iataCode: 'CAI',
        name: 'Cairo International Airport',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        iataCode: 'DXB',
        name: 'Dubai International Airport',
        cityId: 'dubai',
        countryCode: 'AE',
        timeZone: 'Asia/Dubai',
      },
      {
        iataCode: 'JFK',
        name: 'John F. Kennedy International Airport',
        cityId: 'new_york',
        countryCode: 'US',
        timeZone: 'America/New_York',
      },
      {
        iataCode: 'LHR',
        name: 'Heathrow Airport',
        cityId: 'london',
        countryCode: 'GB',
        timeZone: 'Europe/London',
      },
    ]);
    airline = await airlines.create({ name: 'Nile Air', code: 'NA' });
    otherAirline = await airlines.create({ name: 'Delta Wings', code: 'DW' });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(role: Role, providerId?: string) {
    userCounter += 1;
    const email = `flights-user${userCounter}@example.com`;
    await users.create({
      name: `User ${userCounter}`,
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

  const moderatorOf = (a: AirlineDocument) =>
    loggedInAs(Role.AIRLINE_MODERATOR, a.id);

  /** `YYYY-MM-DDTHH:mm` at an airport, as a moderator types it. */
  const localInput = (instant: Date, timeZone: string): string => {
    const local = utcToLocal(instant, timeZone);
    return `${local.date}T${local.time}`;
  };

  /** A future Cairo departure at 10:00 UTC, `days` from now, on its own date. */
  const departureOn = (days: number): Date => {
    const base = new Date(Date.now() + days * DAY);
    base.setUTCHours(10, 0, 0, 0);
    return base;
  };

  const nextDate = (): Date => {
    dateCounter += 1;
    return departureOn(60 + dateCounter);
  };

  interface CabinSeed {
    cabinClass?: CabinClass;
    totalSeats?: number;
    bookedSeats?: number;
    heldSeats?: number;
    price?: number;
  }

  /** A flight inserted directly (counters and statuses the API cannot set). */
  async function insertFlight(
    options: {
      from?: string;
      to?: string;
      departureUtc?: Date;
      durationHours?: number;
      airlineId?: Types.ObjectId;
      status?: FlightStatus;
      everBooked?: boolean;
      cabins?: CabinSeed[];
    } = {},
  ): Promise<FlightDocument> {
    flightCounter += 1;
    const from = options.from ?? 'CAI';
    const departureUtc = options.departureUtc ?? nextDate();
    const zone = from === 'CAI' ? 'Africa/Cairo' : 'Asia/Dubai';
    return flights.create({
      airlineId: options.airlineId ?? airline._id,
      flightNumber: `NA${200 + flightCounter}`,
      departureAirport: from,
      arrivalAirport: options.to ?? 'DXB',
      departureUtc,
      arrivalUtc: new Date(
        departureUtc.getTime() + (options.durationHours ?? 3) * HOUR,
      ),
      departureLocalDate: utcToLocal(departureUtc, zone).date,
      status: options.status ?? FlightStatus.SCHEDULED,
      everBooked: options.everBooked ?? false,
      cabins: (options.cabins ?? [{}]).map((cabin) => ({
        cabinClass: cabin.cabinClass ?? CabinClass.ECONOMY,
        totalSeats: cabin.totalSeats ?? 100,
        bookedSeats: cabin.bookedSeats ?? 0,
        heldSeats: cabin.heldSeats ?? 0,
        price: cabin.price ?? 300,
        freeBags: 1,
        maxBagWeightKg: 23,
      })),
    });
  }

  const localDateOf = (flight: FlightDocument): string =>
    flight.departureLocalDate;

  async function search(
    client: ReturnType<typeof request.agent>,
    date: string,
    extra = '',
  ): Promise<SearchBody> {
    const res = await client
      .get(`/api/flights/search?from=CAI&to=DXB&date=${date}${extra}`)
      .expect(200);
    return res.body as SearchBody;
  }

  describe('moderator creates a flight and its cabins (FLT-03, FLT-04)', () => {
    it('creates the flight in local time, stores UTC, and adds cabins', async () => {
      const mod = await moderatorOf(airline);
      const departureUtc = nextDate();
      const arrivalUtc = new Date(departureUtc.getTime() + 3.5 * HOUR);

      const created = await mod
        .post('/api/flights')
        .send({
          flightNumber: 'na901',
          departureAirport: 'CAI',
          arrivalAirport: 'DXB',
          departureTime: localInput(departureUtc, 'Africa/Cairo'),
          arrivalTime: localInput(arrivalUtc, 'Asia/Dubai'),
        })
        .expect(201);
      const flight = created.body as FlightBody;
      expect(flight.flightNumber).toBe('NA901');
      expect(flight.status).toBe('Scheduled');
      expect(flight.durationMinutes).toBe(210);

      const stored = await flights.findById(flight.id);
      expect(stored?.departureUtc.toISOString()).toBe(
        departureUtc.toISOString(),
      );

      const withCabin = await mod
        .post(`/api/flights/${flight.id}/cabins`)
        .send({
          cabinClass: 'Economy',
          seats: 120,
          price: 250,
          freeBags: 1,
          maxBagWeightKg: 23,
        })
        .expect(201);
      expect((withCabin.body as FlightBody).cabins).toMatchObject([
        { cabinClass: 'Economy', totalSeats: 120, seatsRemaining: 120 },
      ]);

      // Each cabin class once per flight.
      await mod
        .post(`/api/flights/${flight.id}/cabins`)
        .send({
          cabinClass: 'Economy',
          seats: 10,
          price: 100,
          freeBags: 0,
          maxBagWeightKg: 20,
        })
        .expect(409);
    });

    it('rejects the FLT-03 mistakes with field errors', async () => {
      const mod = await moderatorOf(airline);
      const departureUtc = nextDate();
      const base = {
        flightNumber: 'NA902',
        departureAirport: 'CAI',
        arrivalAirport: 'DXB',
        departureTime: localInput(departureUtc, 'Africa/Cairo'),
        arrivalTime: localInput(
          new Date(departureUtc.getTime() + 3 * HOUR),
          'Asia/Dubai',
        ),
      };
      const rejected = async (change: object, field: string) => {
        const res = await mod
          .post('/api/flights')
          .send({ ...base, ...change })
          .expect(400);
        expect((res.body as ErrorBody).errors?.[0].field).toBe(field);
      };
      await rejected({ arrivalAirport: 'CAI' }, 'arrivalAirport');
      await rejected({ arrivalAirport: 'ZZZ' }, 'arrivalAirport');
      await rejected({ departureTime: '2020-01-01T10:00' }, 'departureTime');
      await rejected({ arrivalTime: '2020-01-01T09:00' }, 'arrivalTime');
    });

    it('answers 409 for the same flight number on the same local date (unique index)', async () => {
      const mod = await moderatorOf(airline);
      const departureUtc = nextDate();
      const body = {
        flightNumber: 'NA903',
        departureAirport: 'CAI',
        arrivalAirport: 'DXB',
        departureTime: localInput(departureUtc, 'Africa/Cairo'),
        arrivalTime: localInput(
          new Date(departureUtc.getTime() + 3 * HOUR),
          'Asia/Dubai',
        ),
      };
      await mod.post('/api/flights').send(body).expect(201);
      const duplicate = await mod.post('/api/flights').send(body).expect(409);
      expect((duplicate.body as ErrorBody).errors?.[0].field).toBe(
        'flightNumber',
      );

      // The same number on another date is fine.
      await mod
        .post('/api/flights')
        .send({
          ...body,
          departureTime: localInput(
            new Date(departureUtc.getTime() + DAY),
            'Africa/Cairo',
          ),
          arrivalTime: localInput(
            new Date(departureUtc.getTime() + DAY + 3 * HOUR),
            'Asia/Dubai',
          ),
        })
        .expect(201);
    });

    it('keeps another airline’s moderator out of every edit and view (403)', async () => {
      const owner = await moderatorOf(airline);
      const stranger = await moderatorOf(otherAirline);
      const flight = await insertFlight();
      const id = flight.id;
      const cabinId = flight.cabins[0]._id.toString();

      await stranger
        .patch(`/api/flights/${id}`)
        .send({ departureTime: '2091-01-01T10:00' })
        .expect(403);
      await stranger
        .post(`/api/flights/${id}/cabins`)
        .send({
          cabinClass: 'Business',
          seats: 5,
          price: 900,
          freeBags: 2,
          maxBagWeightKg: 32,
        })
        .expect(403);
      await stranger
        .patch(`/api/flights/${id}/cabins/${cabinId}`)
        .send({ price: 1 })
        .expect(403);
      await stranger
        .post(`/api/flights/${id}/cancel`)
        .send({ confirm: true })
        .expect(403);
      await stranger.get(`/api/flights/${id}/bookings`).expect(403);
      await stranger.get(`/api/airlines/${airline.id}/flights`).expect(403);

      // Nothing changed.
      const after = await flights.findById(id);
      expect(after?.status).toBe(FlightStatus.SCHEDULED);
      expect(after?.cabins[0].price).toBe(300);
      await owner.get(`/api/flights/${id}/bookings`).expect(200);
    });

    it('does not let users or guests create flights', async () => {
      const traveller = await loggedInAs(Role.USER);
      await traveller.post('/api/flights').send({}).expect(403);
      await request(ctx.server).post('/api/flights').send({}).expect(401);
    });
  });

  describe('editing and the seat floor (FLT-04, FLT-05)', () => {
    it('refuses to lower seats below booked + held with SEATS_BELOW_BOOKED', async () => {
      const mod = await moderatorOf(airline);
      const flight = await insertFlight({
        cabins: [{ totalSeats: 100, bookedSeats: 40, heldSeats: 10 }],
      });
      const cabinId = flight.cabins[0]._id.toString();
      const url = `/api/flights/${flight.id}/cabins/${cabinId}`;

      const refused = await mod.patch(url).send({ seats: 49 }).expect(409);
      expect((refused.body as ErrorBody).code).toBe('SEATS_BELOW_BOOKED');
      expect((await flights.findById(flight.id))?.cabins[0].totalSeats).toBe(
        100,
      );

      // Exactly booked + held is allowed; a price change never touches seats.
      await mod.patch(url).send({ seats: 50 }).expect(200);
      await mod.patch(url).send({ price: 410 }).expect(200);
      const after = (await flights.findById(flight.id))?.cabins[0];
      expect(after).toMatchObject({
        totalSeats: 50,
        bookedSeats: 40,
        heldSeats: 10,
        price: 410,
      });
    });

    it('never drops seats below booked + held while holds arrive in parallel', async () => {
      const mod = await moderatorOf(airline);

      for (let round = 0; round < 3; round += 1) {
        const flight = await insertFlight({
          cabins: [{ totalSeats: 10, bookedSeats: 0, heldSeats: 0 }],
        });
        const cabinId = flight.cabins[0]._id;
        const url = `/api/flights/${flight.id}/cabins/${cabinId.toString()}`;

        // A hold takes one seat only if one is free: the same $expr/$filter
        // guard style the booking module uses (FLT-22).
        const hold = () =>
          flights.updateOne(
            {
              _id: flight._id,
              $expr: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: '$cabins',
                        as: 'c',
                        cond: {
                          $and: [
                            { $eq: ['$$c._id', cabinId] },
                            {
                              $gte: [
                                {
                                  $subtract: [
                                    '$$c.totalSeats',
                                    {
                                      $add: [
                                        '$$c.bookedSeats',
                                        '$$c.heldSeats',
                                      ],
                                    },
                                  ],
                                },
                                1,
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                  0,
                ],
              },
            },
            { $inc: { 'cabins.$[c].heldSeats': 1 } },
            { arrayFilters: [{ 'c._id': cabinId }] },
          );

        const results = await Promise.all([
          ...Array.from({ length: 8 }, () => hold()),
          mod.patch(url).send({ seats: 3 }),
          ...Array.from({ length: 8 }, () => hold()),
        ]);

        const reduction = results[8] as request.Response;
        const holdsTaken = (
          results.filter((r, i) => i !== 8) as { modifiedCount: number }[]
        ).reduce((sum, r) => sum + r.modifiedCount, 0);

        const cabin = (await flights.findById(flight.id))?.cabins[0];
        expect(cabin).toBeDefined();
        // The invariant: whichever won, held seats always fit in the total.
        expect(
          (cabin?.heldSeats ?? 0) + (cabin?.bookedSeats ?? 0),
        ).toBeLessThanOrEqual(cabin?.totalSeats ?? 0);
        expect(cabin?.heldSeats).toBe(holdsTaken);
        if (reduction.status === 200) {
          expect(cabin?.totalSeats).toBe(3);
          expect(holdsTaken).toBeLessThanOrEqual(3);
        } else {
          expect(reduction.status).toBe(409);
          expect(cabin?.totalSeats).toBe(10);
          expect(holdsTaken).toBeGreaterThan(3);
        }
      }
    });

    it('blocks an airport change once the flight has been booked, even if all bookings were cancelled', async () => {
      const mod = await moderatorOf(airline);
      const flight = await insertFlight({ everBooked: true });
      const departureUtc = flight.departureUtc;
      const locked = await mod
        .patch(`/api/flights/${flight.id}`)
        .send({
          arrivalAirport: 'LHR',
          arrivalTime: localInput(
            new Date(departureUtc.getTime() + 6 * HOUR),
            'Europe/London',
          ),
        })
        .expect(409);
      expect((locked.body as ErrorBody).code).toBe('AIRPORTS_LOCKED');
      expect((await flights.findById(flight.id))?.arrivalAirport).toBe('DXB');
    });

    it('changes the airports of an unbooked flight, keeping the local time that was typed', async () => {
      const mod = await moderatorOf(airline);
      const flight = await insertFlight();
      const typed = localInput(
        new Date(flight.departureUtc.getTime() + 6 * HOUR),
        'Europe/London',
      );

      // The airport alone is refused: its local time would silently change.
      const missing = await mod
        .patch(`/api/flights/${flight.id}`)
        .send({ arrivalAirport: 'LHR' })
        .expect(400);
      expect((missing.body as ErrorBody).errors?.[0].field).toBe('arrivalTime');

      const res = await mod
        .patch(`/api/flights/${flight.id}`)
        .send({ arrivalAirport: 'LHR', arrivalTime: typed })
        .expect(200);
      const body = res.body as FlightBody;
      expect(`${body.arrival.localDate}T${body.arrival.localTime}`).toBe(typed);
    });

    it('guards the airport lock in the database too, when a hold arrives after the flight was loaded', async () => {
      const mod = await moderatorOf(airline);
      const flight = await insertFlight();
      const stale = await flights.findById(flight.id);

      // A hold lands after the service loaded its copy.
      await flights.updateOne(
        { _id: flight._id },
        { $set: { 'cabins.0.heldSeats': 1 } },
      );
      const spy = jest.spyOn(flights, 'findById').mockResolvedValueOnce(stale);

      const res = await mod
        .patch(`/api/flights/${flight.id}`)
        .send({
          arrivalAirport: 'LHR',
          arrivalTime: localInput(
            new Date(flight.departureUtc.getTime() + 6 * HOUR),
            'Europe/London',
          ),
        })
        .expect(409);
      spy.mockRestore();
      expect((res.body as ErrorBody).code).toBe('FLIGHT_CHANGED');
      expect((await flights.findById(flight.id))?.arrivalAirport).toBe('DXB');
    });

    it('refuses edits once the departure time has passed, even before the minute job runs', async () => {
      const mod = await moderatorOf(airline);
      const flight = await insertFlight({
        departureUtc: new Date(Date.now() - HOUR),
      });
      // Still stored as Scheduled: the job has not run.
      expect((await flights.findById(flight.id))?.status).toBe('Scheduled');
      await mod
        .patch(`/api/flights/${flight.id}`)
        .send({ arrivalTime: '2099-01-01T10:00' })
        .expect(409);
      await mod
        .patch(
          `/api/flights/${flight.id}/cabins/${flight.cabins[0]._id.toString()}`,
        )
        .send({ price: 1 })
        .expect(409);
    });
  });

  describe('flight search (FLT-11, FLT-12, FLT-15)', () => {
    /** Three flights on one date: A cheap-ish and long, B cheapest with one seat, C short with two seats left. */
    async function seedSearchDate() {
      const day = nextDate();
      const at = (hour: number) => {
        const d = new Date(day);
        d.setUTCHours(hour, 0, 0, 0);
        return d;
      };
      const a = await insertFlight({
        departureUtc: at(6),
        durationHours: 3,
        cabins: [
          { price: 300, totalSeats: 5 },
          { cabinClass: CabinClass.BUSINESS, price: 900, totalSeats: 4 },
        ],
      });
      const b = await insertFlight({
        departureUtc: at(8),
        durationHours: 4,
        cabins: [{ price: 100, totalSeats: 1 }],
      });
      const c = await insertFlight({
        departureUtc: at(10),
        durationHours: 2,
        cabins: [{ price: 200, totalSeats: 10, heldSeats: 8 }],
      });
      return { date: localDateOf(a), a, b, c };
    }

    it('lists flights by local date; infants take no seat, children do', async () => {
      const guest = request.agent(ctx.server);
      const { date, a, b, c } = await seedSearchDate();
      const ids = (body: SearchBody) => body.outbound.items.map((f) => f.id);

      const base = await search(guest, date);
      expect(ids(base)).toEqual([a.id, b.id, c.id]);

      // Flight B has one seat: one adult + one infant still fits (infant needs no seat)...
      expect(ids(await search(guest, date, '&adults=1&infants=1'))).toContain(
        b.id,
      );
      // ...one adult + one child needs two seats, so B drops out; C has two left.
      const withChild = await search(guest, date, '&adults=1&children=1');
      expect(ids(withChild)).toEqual([a.id, c.id]);
      // Three seats: C (2 left) drops out too.
      expect(ids(await search(guest, date, '&adults=2&children=1'))).toEqual([
        a.id,
      ]);

      // Seats remaining are reported as total - booked - held.
      const cFlight = base.outbound.items.find((f) => f.id === c.id);
      expect(cFlight?.cabins[0].seatsRemaining).toBe(2);
    });

    it('applies the passenger rules and the airport rules', async () => {
      const guest = request.agent(ctx.server);
      const { date } = await seedSearchDate();
      await guest
        .get(
          `/api/flights/search?from=CAI&to=DXB&date=${date}&adults=1&infants=2`,
        )
        .expect(400);
      await guest
        .get(`/api/flights/search?from=CAI&to=CAI&date=${date}`)
        .expect(400);
      await guest
        .get(`/api/flights/search?from=CAI&to=ZZZ&date=${date}`)
        .expect(400);
    });

    it('filters by an inclusive price range and rejects min above max', async () => {
      const guest = request.agent(ctx.server);
      const { date, a, c } = await seedSearchDate();
      const ids = (body: SearchBody) => body.outbound.items.map((f) => f.id);

      expect(
        ids(await search(guest, date, '&minPrice=150&maxPrice=350')),
      ).toEqual([a.id, c.id]);
      // Inclusive on both ends.
      expect(
        ids(await search(guest, date, '&minPrice=200&maxPrice=200')),
      ).toEqual([c.id]);
      const bad = await guest
        .get(
          `/api/flights/search?from=CAI&to=DXB&date=${date}&minPrice=500&maxPrice=100`,
        )
        .expect(400);
      expect((bad.body as ErrorBody).errors?.[0].field).toBe('minPrice');
    });

    it('lists only the cabins that match the class filter', async () => {
      const guest = request.agent(ctx.server);
      const { date, a } = await seedSearchDate();
      const result = await search(guest, date, '&cabinClass=Business');
      expect(result.outbound.items.map((f) => f.id)).toEqual([a.id]);
      expect(result.outbound.items[0].cabins.map((c) => c.cabinClass)).toEqual([
        'Business',
      ]);
      expect(result.outbound.items[0].fromPrice).toBe(900);
    });

    it('sorts by price, duration and departure, ascending and descending', async () => {
      const guest = request.agent(ctx.server);
      const { date, a, b, c } = await seedSearchDate();
      const order = async (extra: string) =>
        (await search(guest, date, extra)).outbound.items.map((f) => f.id);

      expect(await order('&sortBy=price')).toEqual([b.id, c.id, a.id]);
      expect(await order('&sortBy=price&order=desc')).toEqual([
        a.id,
        c.id,
        b.id,
      ]);
      expect(await order('&sortBy=duration')).toEqual([c.id, a.id, b.id]);
      expect(await order('&sortBy=departure&order=desc')).toEqual([
        c.id,
        b.id,
        a.id,
      ]);
    });

    it('paginates and reports the total', async () => {
      const guest = request.agent(ctx.server);
      const { date, c } = await seedSearchDate();
      const second = await search(guest, date, '&limit=2&page=2');
      expect(second.outbound).toMatchObject({ total: 3, page: 2, limit: 2 });
      expect(second.outbound.items.map((f) => f.id)).toEqual([c.id]);
    });

    it('says "No flights found" for a date with nothing, and searches a round trip', async () => {
      const guest = request.agent(ctx.server);
      const empty = await search(guest, '2001-01-01');
      expect(empty).toMatchObject({ message: 'No flights found' });
      expect(empty.outbound.total).toBe(0);

      const { date, a } = await seedSearchDate();
      const back = await insertFlight({
        from: 'DXB',
        to: 'CAI',
        departureUtc: new Date(a.departureUtc.getTime() + 5 * DAY),
      });
      const returnDate = utcToLocal(back.departureUtc, 'Asia/Dubai').date;
      const trip = await search(guest, date, `&returnDate=${returnDate}`);
      expect(trip.outbound.total).toBe(3);
      expect(trip.return?.items.map((f) => f.id)).toEqual([back.id]);
    });

    it('hides flights of a deactivated airline and Cancelled or Departed flights', async () => {
      const guest = request.agent(ctx.server);
      const { date, a, b } = await seedSearchDate();
      await flights.updateOne(
        { _id: b._id },
        { $set: { status: FlightStatus.CANCELLED } },
      );
      expect(
        (await search(guest, date)).outbound.items.map((f) => f.id),
      ).not.toContain(b.id);

      const hidden = await airlines.create({
        name: 'Ghost Air',
        code: 'GH',
        isActive: false,
      });
      const ghost = await insertFlight({
        airlineId: hidden._id,
        departureUtc: a.departureUtc,
      });
      expect(
        (await search(guest, date)).outbound.items.map((f) => f.id),
      ).not.toContain(ghost.id);
    });
  });

  describe('cancelling a flight (FLT-06)', () => {
    it('needs confirmation, then the flight is Cancelled and leaves the search', async () => {
      const mod = await moderatorOf(airline);
      const guest = request.agent(ctx.server);
      const flight = await insertFlight();
      const date = localDateOf(flight);
      expect(
        (await search(guest, date)).outbound.items.map((f) => f.id),
      ).toContain(flight.id);

      await mod.post(`/api/flights/${flight.id}/cancel`).send({}).expect(400);
      expect((await flights.findById(flight.id))?.status).toBe('Scheduled');

      const res = await mod
        .post(`/api/flights/${flight.id}/cancel`)
        .send({ confirm: true })
        .expect(201);
      expect(res.body).toMatchObject({
        flight: { status: 'Cancelled' },
        cancelledBookings: 0,
        notifiedPassengers: 0,
      });
      expect((await flights.findById(flight.id))?.status).toBe('Cancelled');
      expect(
        (await search(guest, date)).outbound.items.map((f) => f.id),
      ).not.toContain(flight.id);

      // Cancelled flights cannot be edited, and the cancel can be repeated.
      await mod
        .patch(`/api/flights/${flight.id}`)
        .send({ arrivalTime: '2099-01-01T10:00' })
        .expect(409);
      await mod
        .post(`/api/flights/${flight.id}/cancel`)
        .send({ confirm: true })
        .expect(201);
    });

    it('refuses to cancel a flight that has already departed', async () => {
      const mod = await moderatorOf(airline);
      const flight = await insertFlight({ status: FlightStatus.DEPARTED });
      await mod
        .post(`/api/flights/${flight.id}/cancel`)
        .send({ confirm: true })
        .expect(409);
    });
  });

  describe('the airline’s flight list (FLT-05)', () => {
    /** An airline of its own, so counts are exact. */
    // A counter, not a random number: random codes collided on the unique index.
    let nextCode = 10;
    async function freshAirline() {
      const code = `Z${nextCode++}`;
      return airlines.create({ name: `List Air ${code}`, code });
    }

    it('lists newest departure first, paginated, with the same view as the details', async () => {
      const own = await freshAirline();
      const mod = await moderatorOf(own);
      const soon = await insertFlight({
        airlineId: own._id,
        departureUtc: departureOn(100),
      });
      const later = await insertFlight({
        airlineId: own._id,
        departureUtc: departureOn(120),
      });
      const latest = await insertFlight({
        airlineId: own._id,
        departureUtc: departureOn(140),
      });

      const first = await mod
        .get(`/api/airlines/${own.id}/flights?limit=2`)
        .expect(200);
      const body = first.body as Page<FlightBody>;
      expect(body).toMatchObject({ total: 3, page: 1, limit: 2 });
      expect(body.items.map((f) => f.id)).toEqual([latest.id, later.id]);
      expect(body.items[0].departure.localTime).toBeDefined();
      expect(body.items[0].cabins[0].seatsRemaining).toBe(100);

      const second = await mod
        .get(`/api/airlines/${own.id}/flights?limit=2&page=2`)
        .expect(200);
      expect((second.body as Page<FlightBody>).items.map((f) => f.id)).toEqual([
        soon.id,
      ]);

      // Same shape as GET /api/flights/:id.
      const details = await request(ctx.server)
        .get(`/api/flights/${later.id}`)
        .expect(200);
      expect(body.items[1]).toMatchObject({
        id: (details.body as FlightBody).id,
        flightNumber: (details.body as FlightBody).flightNumber,
        durationMinutes: (details.body as FlightBody).durationMinutes,
      });
    });

    it('filters by status, counting a Scheduled flight past its departure time as Departed', async () => {
      const own = await freshAirline();
      const mod = await moderatorOf(own);
      const upcoming = await insertFlight({
        airlineId: own._id,
        departureUtc: departureOn(100),
      });
      const cancelled = await insertFlight({
        airlineId: own._id,
        departureUtc: departureOn(101),
        status: FlightStatus.CANCELLED,
      });
      const departed = await insertFlight({
        airlineId: own._id,
        departureUtc: departureOn(-5),
        status: FlightStatus.DEPARTED,
      });
      // Not marked Departed yet by the job, but its time has passed.
      const justGone = await insertFlight({
        airlineId: own._id,
        departureUtc: new Date(Date.now() - HOUR),
      });

      const ids = async (status: string) =>
        (
          (
            await mod
              .get(`/api/airlines/${own.id}/flights?status=${status}`)
              .expect(200)
          ).body as Page<FlightBody>
        ).items.map((f) => f.id);

      expect(await ids('Scheduled')).toEqual([upcoming.id]);
      expect(await ids('Cancelled')).toEqual([cancelled.id]);
      expect((await ids('Departed')).sort()).toEqual(
        [departed.id, justGone.id].sort(),
      );
      await mod.get(`/api/airlines/${own.id}/flights?status=Nope`).expect(400);

      // The list shows the computed status too.
      const all = (
        (await mod.get(`/api/airlines/${own.id}/flights`).expect(200))
          .body as Page<FlightBody>
      ).items;
      expect(all.find((f) => f.id === justGone.id)?.status).toBe('Departed');
    });

    it('is open to the own moderator and admins only', async () => {
      const own = await freshAirline();
      const url = `/api/airlines/${own.id}/flights`;
      await (await loggedInAs(Role.ADMIN)).get(url).expect(200);
      await (await moderatorOf(own)).get(url).expect(200);
      await (await moderatorOf(otherAirline)).get(url).expect(403);
      await (await loggedInAs(Role.USER)).get(url).expect(403);
      await (
        await loggedInAs(Role.HOTEL_MODERATOR, own.id)
      )
        .get(url)
        .expect(403);
      await request(ctx.server).get(url).expect(401);
      await (
        await loggedInAs(Role.ADMIN)
      )
        .get(`/api/airlines/${new Types.ObjectId().toString()}/flights`)
        .expect(404);
    });
  });
});
