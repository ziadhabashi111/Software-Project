import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { BookingSources } from '../src/admin/booking-sources';
import {
  ContentModerators,
  ContentType,
} from '../src/admin/content-moderators';
import {
  ProviderDirectory,
  ProviderType,
} from '../src/admin/provider-directory';
import { ReportDirectory } from '../src/admin/report-source';
import { buildSwaggerDocument, configureApp } from '../src/app.setup';
import { AuthorItineraries } from '../src/blog/author-itineraries';
import { ReportTargets } from '../src/blog/reports/report-targets';
import { FlightBookingHooks } from '../src/flights/flight-booking-hooks';
import { HotelInventoryRegistry } from '../src/hotel-bookings/hotel-inventory';
import { HotelSearchHook } from '../src/itineraries/hotel-search';
import { ItineraryBudgets } from '../src/itineraries/itinerary-budgets';
import { PlaceCatalog } from '../src/itineraries/places';
import { NOTIFICATION_SERVICE } from '../src/notifications/notification.service.interface';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ADMIN_NOTIFIER } from '../src/admin/admin-notifier';
import { AdminNotifierAdapter } from '../src/notifications/admin-notifier.adapter';
import { PAYMENT_SERVICE } from '../src/payments/payment.service.interface';
import { PaymentsService } from '../src/payments/payments.service';
import { REFUND_SERVICE } from '../src/payments/refund.service.interface';
import { RefundsService } from '../src/payments/refunds.service';
import { STRIPE_CLIENT } from '../src/payments/stripe.provider';
import { ReferenceDataSeeder } from '../src/reference-data/reference-data.seeder';
import { AdminSeeder } from '../src/users/admin-seeder.service';
import { CURRENCY_CATALOG } from '../src/users/currency-catalog';
import { DeactivationBlockers } from '../src/users/deactivation-blockers';

/**
 * Boots the REAL AppModule (every feature module, as in production) against
 * an in-memory MongoDB replica set and checks that the cross-module hooks,
 * registries and shared-service tokens are wired, then walks the main user
 * flows end to end over HTTP. Only Stripe is faked (no network), and the
 * reference data is seeded from the official CSVs (GEN-12).
 */

interface FakeIntent {
  id: string;
  status: string;
  amount: number;
  amount_received: number;
  currency: string;
  client_secret: string;
  metadata: Record<string, string>;
}

const intents = new Map<string, FakeIntent>();
let stripeSeq = 0;
const fakeStripe = {
  paymentIntents: {
    create: jest.fn(
      (params: {
        amount: number;
        currency: string;
        metadata: Record<string, string>;
      }) => {
        stripeSeq += 1;
        const id = `pi_wiring_${stripeSeq}`;
        const intent: FakeIntent = {
          id,
          status: 'requires_payment_method',
          amount: params.amount,
          amount_received: 0,
          currency: params.currency,
          client_secret: `${id}_secret`,
          metadata: params.metadata,
        };
        intents.set(id, intent);
        return Promise.resolve(intent);
      },
    ),
    retrieve: jest.fn((id: string) => Promise.resolve(intents.get(id))),
    cancel: jest.fn((id: string) => {
      const intent = intents.get(id);
      if (intent) intent.status = 'canceled';
      return Promise.resolve(intent);
    }),
  },
  refunds: {
    create: jest.fn(
      (params: {
        payment_intent: string;
        amount?: number;
        metadata?: Record<string, string>;
      }) => {
        stripeSeq += 1;
        return Promise.resolve({
          id: `re_wiring_${stripeSeq}`,
          status: 'succeeded',
          amount: params.amount ?? 0,
          payment_intent: params.payment_intent,
          metadata: params.metadata ?? {},
        });
      },
    ),
    retrieve: jest.fn((id: string) =>
      Promise.resolve({ id, status: 'succeeded' }),
    ),
  },
  webhooks: {
    // The real client checks the HMAC; here a fixed header stands for it.
    constructEvent: jest.fn((raw: Buffer, signature: string) => {
      if (signature !== 'valid-signature') throw new Error('bad signature');
      return JSON.parse(raw.toString()) as unknown;
    }),
  },
};

const PASSWORD = 'Passw0rdOk';
const NEW_PASSWORD = 'Changed0Pass';
type Agent = ReturnType<typeof request.agent>;
type Body = Record<string, unknown>;

describe('Real AppModule wiring and end-to-end flows', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let uploadDir: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 120_000 }],
    });
    uploadDir = mkdtempSync(join(tmpdir(), 'wiring-uploads-'));
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'an-e2e-secret-with-more-than-16-chars';
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.COOKIE_SECURE = 'false';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_wiring_test';
    process.env.UPLOAD_DIR = uploadDir;
    process.env.NODE_ENV = 'test';

    // Imported only now: AppModule validates the environment when it loads.
    const { AppModule } =
      (await import('../src/app.module')) as typeof import('../src/app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STRIPE_CLIENT)
      .useValue(fakeStripe)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    await moduleRef.get(ReferenceDataSeeder).seedFromFiles();
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    rmSync(uploadDir, { recursive: true, force: true });
    process.env = saved;
  });

  // ---------------------------------------------------------------- registries

  describe('Swagger, how Milestone 1 is evaluated', () => {
    it('builds the document for the whole app and tags every operation with a requirement ID', () => {
      const doc = buildSwaggerDocument(app) as unknown as {
        paths: Record<
          string,
          Record<string, { description?: string; summary?: string }>
        >;
      };
      const operations = Object.entries(doc.paths).flatMap(([path, ops]) =>
        Object.entries(ops).map(([method, op]) => ({ path, method, op })),
      );
      expect(operations.length).toBeGreaterThanOrEqual(130);
      const untagged = operations
        .filter(({ path }) => path !== '/api/health')
        .filter(
          ({ op }) =>
            !/[A-Z]{3}-\d{2}/.test(
              `${op.summary ?? ''} ${op.description ?? ''}`,
            ),
        )
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
      expect(untagged).toEqual([]);
    });
  });

  describe('cross-module registries and tokens', () => {
    it('ContentModerators has post, comment, review and itinerary (GEN-10)', () => {
      const moderators = moduleRef.get(ContentModerators);
      for (const type of Object.values(ContentType)) {
        expect([type, moderators.get(type) !== undefined]).toEqual([
          type,
          true,
        ]);
      }
    });

    it('ReportTargets has post, comment, review and itinerary (GEN-09)', () => {
      const targets = moduleRef.get(ReportTargets);
      for (const type of Object.values(ContentType)) {
        expect([type, targets.get(type) !== undefined]).toEqual([type, true]);
      }
    });

    it('DeactivationBlockers has the flight and hotel modules (ACC-12)', () => {
      const blockers = moduleRef.get<
        DeactivationBlockers,
        { blockers: { constructor: { name: string } }[] }
      >(DeactivationBlockers);
      const names = blockers.blockers.map((b) => b.constructor.name).sort();
      expect(names).toEqual([
        'FlightBookingRegistrations',
        'HotelBookingHooks',
      ]);
    });

    it('BookingSources has flight and hotel (ACC-17)', () => {
      const sources = moduleRef.get<
        BookingSources,
        { sources: { type: string }[] }
      >(BookingSources);
      expect(sources.sources.map((s) => s.type).sort()).toEqual([
        'flight',
        'hotel',
      ]);
    });

    it('ProviderDirectory has airline and hotel (ACC-15, ACC-13)', () => {
      const directory = moduleRef.get(ProviderDirectory);
      expect(directory.get(ProviderType.AIRLINE)).toBeDefined();
      expect(directory.get(ProviderType.HOTEL)).toBeDefined();
    });

    it('single-slot hooks are connected', () => {
      expect(moduleRef.get(FlightBookingHooks).get()).toBeDefined(); // FLT-05/06/29
      expect(moduleRef.get(HotelInventoryRegistry).get()).toBeDefined(); // HTL-16
      expect(moduleRef.get(HotelSearchHook).get()).toBeDefined(); // ITN-25
      expect(moduleRef.get(ItineraryBudgets).get()).toBeDefined(); // ITN-14 clone
      expect(moduleRef.get(PlaceCatalog).get()).toBeDefined(); // ITN-05, GEN-12
      expect(moduleRef.get(ReportDirectory).get()).toBeDefined(); // GEN-10
      const authors = moduleRef.get<AuthorItineraries, { source?: unknown }>(
        AuthorItineraries,
      );
      expect(authors.source).toBeDefined(); // BLG-12
    });

    it('shared-service tokens resolve to the real services', () => {
      const get = <T>(token: symbol | string) =>
        moduleRef.get<T>(token, { strict: false });
      expect(get(NOTIFICATION_SERVICE)).toBeInstanceOf(NotificationsService);
      expect(get(ADMIN_NOTIFIER)).toBeInstanceOf(AdminNotifierAdapter);
      expect(get(PAYMENT_SERVICE)).toBeInstanceOf(PaymentsService);
      expect(get(REFUND_SERVICE)).toBeInstanceOf(RefundsService);
      const catalog = get<{ isSupported(code: string): Promise<boolean> }>(
        CURRENCY_CATALOG,
      );
      expect(typeof catalog.isSupported).toBe('function');
    });
  });

  // --------------------------------------------------------------- the flows

  describe('end-to-end flows over HTTP', () => {
    let admin: Agent;
    let airlineMod: Agent;
    let hotelMod: Agent;
    let traveller: Agent;
    let travellerId: string;
    let reporter: Agent;
    let airlineId: string;
    let hotelId: string;
    let flightId: string;
    let roomId: string;
    let flightBookingId: string;
    let hotelReservationId: string;
    let itineraryId: string;
    let postId: string;

    async function login(email: string, password: string): Promise<Agent> {
      const agent = request.agent(server);
      await agent.post('/api/auth/login').send({ email, password }).expect(200);
      return agent;
    }

    /** First login with the temporary password, change it, sign in again. */
    async function moderatorLogin(email: string): Promise<Agent> {
      const first = await login(email, 'Temp0rary1');
      await first
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'Temp0rary1', newPassword: NEW_PASSWORD })
        .expect((res) => expect(res.status).toBeLessThan(300));
      return login(email, NEW_PASSWORD);
    }

    async function registerUser(name: string, email: string): Promise<Agent> {
      await request(server)
        .post('/api/auth/register')
        .send({ name, email, password: PASSWORD, consent: true })
        .expect(201);
      return login(email, PASSWORD);
    }

    /** Sends a Stripe-shaped `payment_intent.succeeded` through the real webhook route. */
    async function paySucceeded(intentId: string): Promise<void> {
      const intent = intents.get(intentId)!;
      intent.status = 'succeeded';
      intent.amount_received = intent.amount;
      const event = {
        id: `evt_${intentId}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: { object: { ...intent } },
      };
      await request(server)
        .post('/api/payments/webhook')
        .set('stripe-signature', 'valid-signature')
        .set('content-type', 'application/json')
        .send(JSON.stringify(event))
        .expect((res) => expect(res.status).toBeLessThan(300));
    }

    async function startPayment(
      type: 'flight' | 'hotel',
      bookingId: string,
    ): Promise<string> {
      await traveller
        .post(`/api/bookings/${type}/${bookingId}/accept-policies`)
        .expect(200);
      await traveller
        .post('/api/payments')
        .send({ bookingType: type, bookingId })
        .expect(201);
      const intent = [...intents.values()].find(
        (i) => i.metadata.bookingId === bookingId,
      );
      expect(intent).toBeDefined();
      return intent!.id;
    }

    it('admin (seeded) creates an airline, a hotel and their moderators (ACC-18, ACC-13, FLT-01, HTL-01)', async () => {
      await moduleRef
        .get(AdminSeeder)
        .seed({ email: 'admin@wiring.test', password: PASSWORD });
      admin = await login('admin@wiring.test', PASSWORD);

      const airline = await admin
        .post('/api/airlines')
        .send({ name: 'Wiring Air', code: 'WR' })
        .expect(201);
      airlineId = (airline.body as Body).id as string;

      const hotel = await admin
        .post('/api/hotels')
        .send({
          name: 'Wiring Palace',
          address: '1 Creek Road',
          city: 'dubai',
          country: 'AE',
          starClass: 4,
        })
        .expect(201);
      hotelId = (hotel.body as Body).id as string;

      await admin
        .post('/api/admin/moderators')
        .send({
          name: 'Air Mod',
          email: 'airmod@wiring.test',
          role: 'airline_moderator',
          providerId: airlineId,
          temporaryPassword: 'Temp0rary1',
        })
        .expect(201);
      await admin
        .post('/api/admin/moderators')
        .send({
          name: 'Hotel Mod',
          email: 'hotelmod@wiring.test',
          role: 'hotel_moderator',
          providerId: hotelId,
          temporaryPassword: 'Temp0rary1',
        })
        .expect(201);
      airlineMod = await moderatorLogin('airmod@wiring.test');
      hotelMod = await moderatorLogin('hotelmod@wiring.test');
    });

    it('the airline moderator sets policies and creates a flight with a cabin (FLT-03, FLT-04, FLT-08, FLT-09)', async () => {
      await airlineMod
        .put(`/api/airlines/${airlineId}/baggage-policy`)
        .send({ extraBagPrice: 25, maxExtraBags: 2 })
        .expect(200);
      await airlineMod
        .put(`/api/airlines/${airlineId}/cancellation-policy`)
        .send({ tiers: [{ daysBefore: 0, refundPercent: 50 }] })
        .expect(200);
      const flight = await airlineMod
        .post('/api/flights')
        .send({
          flightNumber: 'WR100',
          departureAirport: 'CAI',
          arrivalAirport: 'DXB',
          departureTime: '2027-03-01T10:00',
          arrivalTime: '2027-03-01T15:00',
        })
        .expect(201);
      flightId = (flight.body as Body).id as string;
      await airlineMod
        .post(`/api/flights/${flightId}/cabins`)
        .send({
          cabinClass: 'Economy',
          seats: 50,
          price: 200,
          freeBags: 1,
          maxBagWeightKg: 23,
        })
        .expect(201);
    });

    it('the hotel moderator adds a room, its availability and the hotel policies (HTL-03, HTL-04, HTL-09, HTL-10)', async () => {
      const room = await hotelMod
        .post(`/api/hotels/${hotelId}/rooms`)
        .send({ name: '101', beds: 2, maxOccupancy: 2, pricePerNight: 100 })
        .expect(201);
      roomId = (room.body as Body).id as string;
      await hotelMod
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .send({ from: '2027-02-01', to: '2027-04-30' })
        .expect(201);
      await hotelMod
        .put(`/api/hotels/${hotelId}/policies`)
        .send({
          checkInTime: '14:00',
          checkOutTime: '12:00',
          tiers: [{ daysBefore: 0, refundPercent: 50 }],
        })
        .expect(200);
    });

    it('a guest registers, logs in and searches flights and hotels (ACC-01, ACC-04, FLT-11, HTL-11)', async () => {
      traveller = await registerUser('Tara Traveller', 'tara@wiring.test');
      const me = await traveller.get('/api/users/me').expect(200);
      travellerId = (me.body as Body).id as string;

      const flights = await request(server)
        .get('/api/flights/search')
        .query({ from: 'CAI', to: 'DXB', date: '2027-03-01' })
        .expect(200);
      expect(JSON.stringify(flights.body)).toContain(flightId);

      const hotels = await request(server)
        .get('/api/hotels/search')
        .query({
          city: 'dubai',
          checkIn: '2027-03-01',
          checkOut: '2027-03-03',
          guests: 2,
        })
        .expect(200);
      expect(JSON.stringify(hotels.body)).toContain(hotelId);

      const free = await request(server)
        .get(`/api/hotels/${hotelId}/rooms/available`)
        .query({ checkIn: '2027-03-01', checkOut: '2027-03-03' })
        .expect(200);
      expect(JSON.stringify(free.body)).toContain(roomId);
    });

    it('holds, pays (Stripe webhook) and confirms a flight booking, with a notification (FLT-22, PAY-02, PAY-01, FLT-23, GEN-01)', async () => {
      const held = await traveller
        .post('/api/flight-bookings/hold')
        .send({
          outbound: { flightId, cabinClass: 'Economy' },
          passengers: [
            {
              fullName: 'Tara Traveller',
              dateOfBirth: '1990-05-05',
              documentNumber: 'A1234567',
              type: 'adult',
            },
          ],
        })
        .expect(201);
      flightBookingId = (held.body as Body).id as string;
      expect((held.body as Body).status).toBe('PENDING_PAYMENT');

      const policies = await traveller
        .get(`/api/bookings/flight/${flightBookingId}/policies`)
        .expect(200);
      expect(policies.body).toBeDefined();

      const intentId = await startPayment('flight', flightBookingId);
      await paySucceeded(intentId);

      const booking = await traveller
        .get(`/api/flight-bookings/${flightBookingId}`)
        .expect(200);
      expect((booking.body as Body).status).toBe('CONFIRMED');
      expect((booking.body as Body).reference).toEqual(expect.any(String));

      const mine = await traveller
        .get('/api/flight-bookings')
        .query({ group: 'upcoming' })
        .expect(200);
      expect(JSON.stringify(mine.body)).toContain(flightBookingId);

      const notes = await traveller.get('/api/notifications').expect(200);
      expect(((notes.body as Body).items as unknown[]).length).toBeGreaterThan(
        0,
      );
    });

    it('previews and cancels the flight booking with a refund (FLT-26, PAY-03)', async () => {
      const preview = await traveller
        .post(`/api/flight-bookings/${flightBookingId}/cancel`)
        .send({})
        .expect(200);
      expect((preview.body as Body).cancelled).toBe(false);

      const done = await traveller
        .post(`/api/flight-bookings/${flightBookingId}/cancel`)
        .send({ confirm: true })
        .expect(200);
      expect((done.body as Body).cancelled).toBe(true);
      expect(fakeStripe.refunds.create).toHaveBeenCalled();

      const booking = await traveller
        .get(`/api/flight-bookings/${flightBookingId}`)
        .expect(200);
      expect((booking.body as Body).status).toBe('CANCELLED');
    });

    it('holds, pays and confirms a hotel reservation (HTL-16, HTL-18, PAY-01, HTL-17)', async () => {
      const held = await traveller
        .post('/api/hotel-bookings')
        .send({
          hotelId,
          checkIn: '2027-03-10',
          checkOut: '2027-03-12',
          rooms: [{ roomId, adults: 2 }],
        })
        .expect(201);
      hotelReservationId = (held.body as Body).id as string;

      const intentId = await startPayment('hotel', hotelReservationId);
      await paySucceeded(intentId);

      const reservation = await traveller
        .get(`/api/hotel-bookings/${hotelReservationId}`)
        .expect(200);
      expect((reservation.body as Body).status).toBe('CONFIRMED');

      const forModerator = await hotelMod
        .get(`/api/hotels/${hotelId}/reservations`)
        .expect(200);
      expect(JSON.stringify(forModerator.body)).toContain(hotelReservationId);

      const adminList = await admin
        .get('/api/admin/bookings')
        .query({ type: 'hotel' })
        .expect(200);
      expect(JSON.stringify(adminList.body)).toContain(hotelReservationId);
    });

    it('creates a public itinerary and finds it, its hotels and its flights (ITN-01, ITN-05, ITN-20, ITN-21, ITN-25, ITN-26)', async () => {
      const created = await traveller
        .post('/api/itineraries')
        .send({
          title: 'Wiring week in Dubai',
          countries: ['AE'],
          startDate: '2027-03-01',
        })
        .expect(201);
      itineraryId = (created.body as Body).id as string;
      await traveller
        .post(`/api/itineraries/${itineraryId}/days`)
        .send({ city: 'dubai' })
        .expect(201);
      await traveller
        .patch(`/api/itineraries/${itineraryId}`)
        .send({ visibility: 'public' })
        .expect(200);

      const found = await request(server)
        .get('/api/itineraries/public/search')
        .query({ q: 'Wiring' })
        .expect(200);
      expect(JSON.stringify(found.body)).toContain(itineraryId);

      const hotels = await traveller
        .get(`/api/itineraries/${itineraryId}/hotels`)
        .query({ group: 1, guests: 2 })
        .expect(200);
      expect(JSON.stringify(hotels.body)).toContain(hotelId);

      const flights = await traveller
        .get(`/api/itineraries/${itineraryId}/flights`)
        .query({ from: 'CAI' })
        .expect(200);
      expect(JSON.stringify(flights.body)).toContain(flightId);
    });

    it('publishes a post that gets a comment, a like and a report (BLG-01, BLG-05, BLG-06, GEN-09)', async () => {
      const post = await traveller
        .post('/api/posts')
        .send({
          title: 'Wiring trip report',
          body: 'Everything was connected.',
          status: 'published',
        })
        .expect(201);
      postId = (post.body as Body).id as string;

      reporter = await registerUser('Remy Reporter', 'remy@wiring.test');
      await reporter
        .post(`/api/posts/${postId}/comments`)
        .send({ body: 'Nice!' })
        .expect(201);
      await reporter
        .post(`/api/posts/${postId}/like`)
        .expect((res) => expect(res.status).toBeLessThan(300));
      await reporter
        .post('/api/reports')
        .send({ contentType: 'post', contentId: postId, reason: 'Spam' })
        .expect(201);
      // A private itinerary cannot be reported by someone else (GEN-09 check wired).
      const privateOne = await traveller
        .post('/api/itineraries')
        .send({ title: 'Secret', countries: ['AE'], startDate: '2027-05-01' })
        .expect(201);
      await reporter
        .post('/api/reports')
        .send({
          contentType: 'itinerary',
          contentId: (privateOne.body as Body).id,
          reason: 'Spam',
        })
        .expect(404);
    });

    it('the admin hides the reported post and the action is audited (GEN-10, GEN-07)', async () => {
      const reports = await admin.get('/api/admin/reports').expect(200);
      const items = (reports.body as Body).items as Body[];
      const report = items.find(
        (r) => JSON.stringify(r).includes(postId) && r.id,
      );
      expect(report).toBeDefined();
      await admin
        .patch(`/api/admin/reports/${report!.id as string}`)
        .send({ action: 'hide' })
        .expect(200);

      await request(server).get(`/api/posts/${postId}`).expect(404);

      const audit = await admin.get('/api/admin/audit-logs').expect(200);
      expect(JSON.stringify(audit.body)).toContain(postId);
    });

    it('a user with an unpaid hold can deactivate; the hold ends (ACC-12)', async () => {
      const held = await traveller
        .post('/api/flight-bookings/hold')
        .send({
          outbound: { flightId, cabinClass: 'Economy' },
          passengers: [
            {
              fullName: 'Tara Traveller',
              dateOfBirth: '1990-05-05',
              documentNumber: 'A1234567',
              type: 'adult',
            },
          ],
        })
        .expect(201);
      const holdId = (held.body as Body).id as string;
      // The confirmed hotel stay blocks deactivation first.
      await traveller.delete('/api/users/me?confirm=true').expect(409);
      await traveller
        .post(`/api/hotel-bookings/${hotelReservationId}/cancel?confirm=true`)
        .expect(200);
      await traveller.delete('/api/users/me?confirm=true').expect(204);
      const admins = await admin
        .get('/api/admin/bookings')
        .query({ type: 'flight' })
        .expect(200);
      const row = ((admins.body as Body).items as Body[]).find(
        (b) => b.id === holdId,
      );
      expect(row?.status).toBe('EXPIRED');
      expect(travellerId).toEqual(expect.any(String));
    });
  });
});
