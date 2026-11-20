import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { PasswordService } from '../src/auth/password.service';
import { BookingStatus } from '../src/common/booking-status/booking-status';
import { FlightBookingChangesService } from '../src/flight-bookings/flight-booking-changes.service';
import {
  FlightBookingChange,
  FlightBookingChangeDocument,
} from '../src/flight-bookings/schemas/flight-booking-change.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../src/flight-bookings/schemas/flight-booking.schema';
import { CabinClass, FlightStatus } from '../src/flights/flight-status';
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
import {
  Notification,
  NotificationDocument,
} from '../src/notifications/schemas/notification.schema';
import { Refund, RefundDocument } from '../src/payments/schemas/refund.schema';
import { STRIPE_CLIENT } from '../src/payments/stripe.provider';
import { UsersService } from '../src/users/users.service';

/**
 * FLT-27 end to end through the real AppModule (flights, flight bookings,
 * payments with a fake Stripe client, notifications), on an in-memory
 * MongoDB replica set so the seat transactions run for real.
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
        const id = `pi_change_${stripeSeq}`;
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
          id: `re_change_${stripeSeq}`,
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
    constructEvent: jest.fn((raw: Buffer, signature: string) => {
      if (signature !== 'valid-signature') throw new Error('bad signature');
      return JSON.parse(raw.toString()) as unknown;
    }),
  },
};

const PASSWORD = 'Passw0rdOk';
const DAY = 86_400_000;
type Agent = ReturnType<typeof request.agent>;

interface ErrorBody {
  code?: string;
  errors?: { field: string }[];
}

interface BookingBody {
  id: string;
  status: string;
  price: { total: number; perSegment: number[] };
  segments: { flightId: string }[];
}

interface PreviewBody {
  changed: boolean;
  action: 'pay' | 'refund' | 'none';
  currentSegmentTotal: number;
  newSegmentTotal: number;
  difference: number;
  newFlight: { flightId: string; flightNumber: string };
  changeId?: string;
  booking?: BookingBody;
}

describe('Change a confirmed flight booking (FLT-27; real AppModule, MongoDB replica set)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let uploadDir: string;
  const saved = { ...process.env };

  let flights: Model<FlightDocument>;
  let airlines: Model<AirlineDocument>;
  let bookings: Model<FlightBookingDocument>;
  let changes: Model<FlightBookingChangeDocument>;
  let refunds: Model<RefundDocument>;
  let notifications: Model<NotificationDocument>;
  let airline: AirlineDocument;
  let otherAirline: AirlineDocument;
  let userCount = 0;
  let flightCount = 0;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 120_000 }],
    });
    uploadDir = mkdtempSync(join(tmpdir(), 'change-uploads-'));
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = 'an-e2e-secret-with-more-than-16-chars';
    process.env.JWT_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.COOKIE_SECURE = 'false';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_change_test';
    process.env.UPLOAD_DIR = uploadDir;
    process.env.NODE_ENV = 'test';

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

    flights = moduleRef.get(getModelToken(Flight.name));
    airlines = moduleRef.get(getModelToken(Airline.name));
    bookings = moduleRef.get(getModelToken(FlightBooking.name));
    changes = moduleRef.get(getModelToken(FlightBookingChange.name));
    refunds = moduleRef.get(getModelToken(Refund.name));
    notifications = moduleRef.get(getModelToken(Notification.name));
    await Promise.all([
      flights.syncIndexes(),
      bookings.syncIndexes(),
      changes.syncIndexes(),
      refunds.syncIndexes(),
    ]);
    const airports: Model<AirportDocument> = moduleRef.get(
      getModelToken(Airport.name),
    );
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
        iataCode: 'JED',
        name: 'King Abdulaziz International Airport',
        cityId: 'jeddah',
        countryCode: 'SA',
        timeZone: 'Asia/Riyadh',
      },
    ]);
    const policies = {
      isActive: true,
      baggagePolicy: { extraBagPrice: 30, maxExtraBags: 2 },
      cancellationPolicy: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ],
    };
    airline = await airlines.create({
      name: 'Nile Air',
      code: 'NA',
      ...policies,
    });
    otherAirline = await airlines.create({
      name: 'Delta Wings',
      code: 'DW',
      ...policies,
    });
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    rmSync(uploadDir, { recursive: true, force: true });
    process.env = saved;
  });

  beforeEach(() => {
    fakeStripe.refunds.create.mockClear();
  });

  async function loggedIn(): Promise<Agent> {
    userCount += 1;
    const email = `changer${userCount}@example.com`;
    const passwords = moduleRef.get(PasswordService);
    await moduleRef.get(UsersService).create({
      name: `Changer ${userCount}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
    });
    const agent = request.agent(server);
    await agent
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return agent;
  }

  async function makeFlight(
    options: {
      from?: string;
      to?: string;
      departInDays?: number;
      seats?: number;
      price?: number;
      airlineId?: Types.ObjectId;
    } = {},
  ): Promise<FlightDocument> {
    flightCount += 1;
    const from = options.from ?? 'CAI';
    const zone =
      from === 'CAI'
        ? 'Africa/Cairo'
        : from === 'JED'
          ? 'Asia/Riyadh'
          : 'Asia/Dubai';
    const departureUtc = new Date(
      Date.now() + (options.departInDays ?? 40) * DAY,
    );
    return flights.create({
      airlineId: options.airlineId ?? airline._id,
      flightNumber: `NA${500 + flightCount}`,
      departureAirport: from,
      arrivalAirport: options.to ?? 'DXB',
      departureUtc,
      arrivalUtc: new Date(departureUtc.getTime() + 3.5 * 3_600_000),
      departureLocalDate: utcToLocal(departureUtc, zone).date,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          cabinClass: CabinClass.ECONOMY,
          totalSeats: options.seats ?? 10,
          price: options.price ?? 200,
          freeBags: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
  }

  const adult = {
    fullName: 'Mona Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: 'A1234567',
    type: 'adult',
  };

  /** Sends a Stripe-shaped `payment_intent.succeeded` through the webhook. */
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

  function intentFor(bookingId: string): FakeIntent {
    const intent = [...intents.values()].find(
      (i) => i.metadata.bookingId === bookingId,
    );
    expect(intent).toBeDefined();
    return intent!;
  }

  /** A Confirmed booking paid through the real payments flow. */
  async function confirmedBooking(
    flight: FlightDocument,
    passengers: object[] = [adult],
    returnFlight?: FlightDocument,
  ): Promise<{ agent: Agent; booking: BookingBody; intentId: string }> {
    const agent = await loggedIn();
    const held = await agent
      .post('/api/flight-bookings/hold')
      .send({
        outbound: { flightId: flight.id, cabinClass: 'Economy' },
        ...(returnFlight
          ? { return: { flightId: returnFlight.id, cabinClass: 'Economy' } }
          : {}),
        passengers,
      })
      .expect(201);
    const id = (held.body as BookingBody).id;
    await agent.post(`/api/bookings/flight/${id}/accept-policies`).expect(200);
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: id })
      .expect(201);
    const intentId = intentFor(id).id;
    await paySucceeded(intentId);
    const res = await agent.get(`/api/flight-bookings/${id}`).expect(200);
    const booking = res.body as BookingBody;
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    return { agent, booking, intentId };
  }

  const change = (
    agent: Agent,
    bookingId: string,
    body: object,
    confirm = false,
  ) =>
    agent
      .patch(
        `/api/flight-bookings/${bookingId}/change-flight${confirm ? '?confirm=true' : ''}`,
      )
      .send(body);

  async function cabin(flight: FlightDocument) {
    return (await flights.findById(flight._id).lean())!.cabins[0];
  }

  it('previews a change without changing anything', async () => {
    const from = await makeFlight({ price: 200 });
    const to = await makeFlight({ price: 260, departInDays: 45 });
    const { agent, booking } = await confirmedBooking(from);

    const res = await change(agent, booking.id, { flightId: to.id }).expect(
      200,
    );
    const preview = res.body as PreviewBody;
    expect(preview).toMatchObject({
      changed: false,
      action: 'pay',
      currentSegmentTotal: 200,
      newSegmentTotal: 260,
      difference: 60,
      newFlight: { flightId: to.id },
    });
    expect((await cabin(to)).heldSeats).toBe(0);
    expect((await cabin(from)).bookedSeats).toBe(1);
    expect(await changes.countDocuments({})).toBe(0);
  });

  it('applies a same-fare change at once, moving the seats and notifying', async () => {
    const from = await makeFlight({ price: 200 });
    const to = await makeFlight({ price: 200, departInDays: 46 });
    const { agent, booking } = await confirmedBooking(from);

    const res = await change(
      agent,
      booking.id,
      { flightId: to.id },
      true,
    ).expect(200);
    const body = res.body as PreviewBody;
    expect(body).toMatchObject({
      changed: true,
      action: 'none',
      difference: 0,
    });
    expect(body.booking?.segments[0].flightId).toBe(to.id);
    expect(await cabin(from)).toMatchObject({ bookedSeats: 0, heldSeats: 0 });
    expect(await cabin(to)).toMatchObject({ bookedSeats: 1, heldSeats: 0 });
    expect(fakeStripe.refunds.create).not.toHaveBeenCalled();
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.segments[0].flight.toString()).toBe(to.id);
    expect(
      await notifications.exists({
        userId: stored!.user,
        type: 'FLIGHT_BOOKING_CHANGED',
      }),
    ).not.toBeNull();
  });

  it('refunds the difference of a cheaper flight to the original card', async () => {
    const from = await makeFlight({ price: 300 });
    const to = await makeFlight({ price: 220, departInDays: 47 });
    const { agent, booking, intentId } = await confirmedBooking(from);

    const res = await change(
      agent,
      booking.id,
      { flightId: to.id },
      true,
    ).expect(200);
    expect(res.body).toMatchObject({
      changed: true,
      action: 'refund',
      difference: -80,
    });
    expect(fakeStripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(fakeStripe.refunds.create.mock.calls[0][0]).toMatchObject({
      payment_intent: intentId,
      amount: 8000,
    });
    const refund = await refunds.findOne({ kind: 'fare_difference' }).lean();
    expect(refund).toMatchObject({
      bookingType: 'flight-change',
      amount: 80,
      status: 'REFUNDED',
    });
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.price.total).toBe(220);
    expect(stored?.payments).toEqual([
      expect.objectContaining({
        paymentIntentId: intentId,
        amount: 300,
        refunded: 80,
      }),
    ]);
  });

  it('holds the seats of a dearer flight, then applies the change once the difference is paid', async () => {
    const from = await makeFlight({ price: 200 });
    const to = await makeFlight({ price: 290, departInDays: 48 });
    const { agent, booking, intentId } = await confirmedBooking(from);

    const res = await change(
      agent,
      booking.id,
      { flightId: to.id },
      true,
    ).expect(200);
    const body = res.body as PreviewBody;
    expect(body).toMatchObject({
      changed: false,
      action: 'pay',
      difference: 90,
    });
    expect(body.changeId).toBeDefined();
    expect(await cabin(to)).toMatchObject({ heldSeats: 1, bookedSeats: 0 });

    // A second change while this one waits for payment is refused.
    const other = await makeFlight({ price: 200, departInDays: 49 });
    const pending = await change(
      agent,
      booking.id,
      { flightId: other.id },
      true,
    ).expect(409);
    expect((pending.body as ErrorBody).code).toBe('CHANGE_PENDING');

    // The original booking's accepted policies cover the change (PAY-02).
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight-change', bookingId: body.changeId })
      .expect(201);
    const changeIntent = intentFor(body.changeId!);
    expect(changeIntent.amount).toBe(9000);
    await paySucceeded(changeIntent.id);

    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.segments[0].flight.toString()).toBe(to.id);
    expect(stored?.price.total).toBe(290);
    expect(stored?.payments?.map((p) => [p.paymentIntentId, p.amount])).toEqual(
      [
        [intentId, 200],
        [changeIntent.id, 90],
      ],
    );
    expect(await cabin(to)).toMatchObject({ heldSeats: 0, bookedSeats: 1 });
    expect(await cabin(from)).toMatchObject({ bookedSeats: 0 });
    expect((await changes.findById(body.changeId).lean())?.status).toBe(
      BookingStatus.CONFIRMED,
    );
  });

  it('releases the held seats when an unpaid change runs out', async () => {
    const from = await makeFlight({ price: 200 });
    const to = await makeFlight({ price: 250, departInDays: 50 });
    const { agent, booking } = await confirmedBooking(from);
    const res = await change(
      agent,
      booking.id,
      { flightId: to.id },
      true,
    ).expect(200);
    const changeId = (res.body as PreviewBody).changeId!;
    expect((await cabin(to)).heldSeats).toBe(1);

    await moduleRef
      .get(FlightBookingChangesService)
      .expireDueChanges(new Date(Date.now() + 11 * 60_000));

    expect((await changes.findById(changeId).lean())?.status).toBe(
      BookingStatus.EXPIRED,
    );
    expect((await cabin(to)).heldSeats).toBe(0);
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.segments[0].flight.toString()).toBe(from.id);
    // The booking can be changed again.
    await change(agent, booking.id, { flightId: to.id }).expect(200);
  });

  it('lets only one of two parallel changes take the last seat', async () => {
    const to = await makeFlight({ price: 200, departInDays: 51, seats: 1 });
    const a = await confirmedBooking(await makeFlight({ price: 200 }));
    const b = await confirmedBooking(await makeFlight({ price: 200 }));

    const results = await Promise.all([
      change(a.agent, a.booking.id, { flightId: to.id }, true),
      change(b.agent, b.booking.id, { flightId: to.id }, true),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await cabin(to)).toMatchObject({ bookedSeats: 1, heldSeats: 0 });
  });

  it('refunds a cancellation across both payments after a dearer change, newest first', async () => {
    const from = await makeFlight({ price: 200 });
    const to = await makeFlight({ price: 260, departInDays: 52 });
    const { agent, booking, intentId } = await confirmedBooking(from);
    const res = await change(
      agent,
      booking.id,
      { flightId: to.id },
      true,
    ).expect(200);
    const changeId = (res.body as PreviewBody).changeId!;
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight-change', bookingId: changeId })
      .expect(201);
    const changeIntent = intentFor(changeId);
    await paySucceeded(changeIntent.id);
    fakeStripe.refunds.create.mockClear();

    await agent
      .post(`/api/flight-bookings/${booking.id}/cancel`)
      .send({ confirm: true })
      .expect(200);

    const calls = fakeStripe.refunds.create.mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({
        payment_intent: changeIntent.id,
        amount: 6000,
      }),
      expect.objectContaining({ payment_intent: intentId, amount: 20000 }),
    ]);
    const stored = await bookings.findById(booking.id).lean();
    expect(stored?.status).toBe(BookingStatus.CANCELLED);
    expect(stored?.refund).toMatchObject({
      amount: 260,
      percent: 100,
      status: 'REFUNDED',
    });
    expect(stored?.refund?.parts).toHaveLength(2);
    expect((await cabin(to)).bookedSeats).toBe(0);
  });

  it('checks the passenger types again against the new outbound date', async () => {
    const from = await makeFlight({ price: 200, departInDays: 40 });
    const later = await makeFlight({ price: 200, departInDays: 80 });
    // Eleven on the first flight, twelve (an adult) on the later one.
    const birthday = new Date(Date.now() + 60 * DAY);
    birthday.setUTCFullYear(birthday.getUTCFullYear() - 12);
    const child = {
      fullName: 'Omar Adel',
      dateOfBirth: birthday.toISOString().slice(0, 10),
      documentNumber: 'C1112223',
      type: 'child',
    };
    const { agent, booking } = await confirmedBooking(from, [adult, child]);

    const res = await change(agent, booking.id, { flightId: later.id }).expect(
      400,
    );
    expect((res.body as ErrorBody).errors?.[0]?.field).toBe(
      'passengers.1.type',
    );
  });

  it('refuses another airline, another route, a booking that is not yours, and a one-way return change', async () => {
    const from = await makeFlight({ price: 200 });
    const { agent, booking } = await confirmedBooking(from);

    const foreign = await makeFlight({ airlineId: otherAirline._id });
    const r1 = await change(agent, booking.id, { flightId: foreign.id }).expect(
      400,
    );
    expect((r1.body as ErrorBody).errors?.[0]?.field).toBe('flightId');

    const elsewhere = await makeFlight({ to: 'JED' });
    const r2 = await change(agent, booking.id, {
      flightId: elsewhere.id,
    }).expect(400);
    expect((r2.body as ErrorBody).errors?.[0]?.field).toBe('flightId');

    const same = await change(agent, booking.id, { flightId: from.id }).expect(
      400,
    );
    expect((same.body as ErrorBody).errors?.[0]?.field).toBe('flightId');

    const stranger = await loggedIn();
    const ok = await makeFlight({ departInDays: 44 });
    await change(stranger, booking.id, { flightId: ok.id }).expect(404);

    const r3 = await change(agent, booking.id, {
      flightId: ok.id,
      segmentIndex: 1,
    }).expect(400);
    expect((r3.body as ErrorBody).errors?.[0]?.field).toBe('segmentIndex');
  });

  it('keeps a round trip in order when the outbound moves', async () => {
    const out = await makeFlight({ price: 200, departInDays: 40 });
    const back = await makeFlight({
      from: 'DXB',
      to: 'CAI',
      price: 200,
      departInDays: 45,
    });
    const { agent, booking } = await confirmedBooking(out, [adult], back);
    const afterReturn = await makeFlight({ price: 200, departInDays: 50 });

    const res = await change(agent, booking.id, {
      flightId: afterReturn.id,
    }).expect(400);
    expect((res.body as ErrorBody).errors?.[0]?.field).toBe('flightId');

    const newBack = await makeFlight({
      from: 'DXB',
      to: 'CAI',
      price: 230,
      departInDays: 47,
    });
    const ret = await change(agent, booking.id, {
      flightId: newBack.id,
      segmentIndex: 1,
    }).expect(200);
    expect(ret.body).toMatchObject({ action: 'pay', difference: 30 });
  });
});
