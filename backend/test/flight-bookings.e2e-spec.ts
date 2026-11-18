import { Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { FlightBookingExpiryService } from '../src/flight-bookings/flight-booking-expiry.service';
import { FlightBookingPayments } from '../src/flight-bookings/flight-booking-payments';
import { FlightBookingsModule } from '../src/flight-bookings/flight-bookings.module';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../src/flight-bookings/schemas/flight-booking.schema';
import { FlightBookingHooks } from '../src/flights/flight-booking-hooks';
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
import { NOTIFICATION_SERVICE } from '../src/notifications/notification.service.interface';
import { PAYMENT_SERVICE } from '../src/payments/payment.service.interface';
import { REFUND_SERVICE } from '../src/payments/refund.service.interface';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const DAY = 86_400_000;

interface ErrorBody {
  statusCode: number;
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface BookingBody {
  id: string;
  reference: string | null;
  status: string;
  statusLabel: string;
  holdExpiresAt: string | null;
  seats: number;
  price: { total: number; perSegment: number[] };
  segments: { flightId: string; departure: { localTime: string } }[];
  payment: { status?: string } | null;
  refund: { percent: number; amount: number; status?: string } | null;
  cancellation?: { refundPercent: number; refundAmount: number } | null;
}

/** Stand-ins for Ziad's notification, payment and refund services. */
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

describe('Flight bookings (FLT-12..26; real flights module, MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let flights: Model<FlightDocument>;
  let airlines: Model<AirlineDocument>;
  let bookings: Model<FlightBookingDocument>;
  let airline: AirlineDocument;
  let counter = 0;
  let flightCounter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [
        AuditModule,
        AdminModule,
        FlightsModule,
        FlightBookingsModule,
        FakeSharedServicesModule,
      ],
      replSet: true,
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    flights = ctx.moduleRef.get(getModelToken(Flight.name));
    airlines = ctx.moduleRef.get(getModelToken(Airline.name));
    bookings = ctx.moduleRef.get(getModelToken(FlightBooking.name));
    const airports: Model<AirportDocument> = ctx.moduleRef.get(
      getModelToken(Airport.name),
    );
    await Promise.all([flights.syncIndexes(), bookings.syncIndexes()]);

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
    ]);
    airline = await airlines.create({
      name: 'Nile Air',
      code: 'NA',
      isActive: true,
      baggagePolicy: { extraBagPrice: 30, maxExtraBags: 2 },
      cancellationPolicy: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function loggedInAs(role: Role = Role.USER, providerId?: string) {
    counter += 1;
    const email = `traveller${counter}@example.com`;
    const doc = await users.create({
      name: `Traveller ${counter}`,
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

  /** A Scheduled flight with one Economy cabin, inserted directly. */
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
    flightCounter += 1;
    const from = options.from ?? 'CAI';
    const departureUtc = new Date(
      Date.now() + (options.departInDays ?? 40) * DAY,
    );
    return flights.create({
      airlineId: options.airlineId ?? airline._id,
      flightNumber: `NA${100 + flightCounter}`,
      departureAirport: from,
      arrivalAirport: options.to ?? 'DXB',
      departureUtc,
      arrivalUtc: new Date(departureUtc.getTime() + 3.5 * 3_600_000),
      departureLocalDate: utcToLocal(
        departureUtc,
        from === 'CAI' ? 'Africa/Cairo' : 'Asia/Dubai',
      ).date,
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

  const adult = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Mona Adel',
    dateOfBirth: '1990-05-01',
    documentNumber: 'A1234567',
    type: 'adult',
    ...overrides,
  });
  const infant = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Baby Adel',
    dateOfBirth: new Date(Date.now() - 200 * DAY).toISOString().slice(0, 10),
    documentNumber: 'B7654321',
    type: 'infant',
    ...overrides,
  });

  function bookingBody(
    flight: FlightDocument,
    passengers: object[] = [adult()],
    extra: Record<string, unknown> = {},
  ) {
    return {
      outbound: { flightId: flight.id, cabinClass: 'Economy' },
      passengers,
      ...extra,
    };
  }

  const summary = (client: Client, body: object) =>
    client.post('/api/flight-bookings').send(body);

  async function cabinOf(flight: FlightDocument) {
    const fresh = await flights.findById(flight._id).lean();
    return fresh!.cabins[0];
  }

  const hold = (client: Client, body: object) =>
    client.post('/api/flight-bookings/hold').send(body);

  const child = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Omar Adel',
    dateOfBirth: new Date(Date.now() - 6 * 365 * DAY)
      .toISOString()
      .slice(0, 10),
    documentNumber: 'C1112223',
    type: 'child',
    ...overrides,
  });

  /** A held booking for a fresh user, returned with that user. */
  async function heldBooking(
    flight: FlightDocument,
    passengers: object[] = [adult()],
    extra: Record<string, unknown> = {},
  ) {
    const user = await loggedInAs();
    const res = await hold(
      user.client,
      bookingBody(flight, passengers, extra),
    ).expect(201);
    return { user, booking: res.body as BookingBody };
  }

  /** The airline's moderator, logged in. */
  const moderator = () => loggedInAs(Role.AIRLINE_MODERATOR, airline.id);

  describe('booking summary (FLT-19, FLT-21, FLT-12)', () => {
    it('prices passengers, the infant share and extra bags without holding seats', async () => {
      const flight = await makeFlight({ price: 200 });
      const { client } = await loggedInAs();
      const res = await summary(
        client,
        bookingBody(flight, [
          adult({ extraBags: 1, extraBagWeightKg: 20 }),
          infant(),
        ]),
      ).expect(200);
      const body = res.body as {
        price: { fares: number; baggage: number; total: number };
        currency: string;
        seats: number;
        segments: {
          departure: { localTime: string; airport: { timeZone: string } };
        }[];
        passengers: { type: string; fare: number; baggageFee: number }[];
        policies: { cancellationTiers: unknown[] };
      };
      expect(body.price).toMatchObject({ fares: 220, baggage: 30, total: 250 });
      expect(body.currency).toBe('USD');
      expect(body.seats).toBe(1);
      expect(body.passengers.map((p) => p.type)).toEqual(['adult', 'infant']);
      expect(body.segments[0].departure.airport.timeZone).toBe('Africa/Cairo');
      expect(body.segments[0].departure.localTime).toBe(
        utcToLocal(flight.departureUtc, 'Africa/Cairo').time,
      );
      expect(body.policies.cancellationTiers).toHaveLength(2);
      expect((await cabinOf(flight)).heldSeats).toBe(0);
      expect(await bookings.countDocuments()).toBe(0);
    });

    it('rejects a cabin class the flight does not have', async () => {
      const flight = await makeFlight();
      const { client } = await loggedInAs();
      const res = await summary(client, {
        ...bookingBody(flight),
        outbound: { flightId: flight.id, cabinClass: 'First' },
      }).expect(400);
      expect((res.body as ErrorBody).errors?.[0].field).toBe(
        'outbound.cabinClass',
      );
    });

    it('rejects a passenger type that does not match the date of birth', async () => {
      const flight = await makeFlight();
      const { client } = await loggedInAs();
      const res = await summary(
        client,
        bookingBody(flight, [adult({ dateOfBirth: '2020-01-01' })]),
      ).expect(400);
      expect((res.body as ErrorBody).errors?.[0].field).toBe(
        'passengers.0.type',
      );
    });

    it('is for registered users only', async () => {
      const flight = await makeFlight();
      await request(ctx.server)
        .post('/api/flight-bookings')
        .send(bookingBody(flight))
        .expect(401);
      const { client } = await loggedInAs(Role.ADMIN);
      await summary(client, bookingBody(flight)).expect(403);
    });
  });
  describe('seat hold (FLT-22, FLT-12)', () => {
    it('holds seats for 10 minutes as Pending Payment', async () => {
      const flight = await makeFlight();
      const before = Date.now();
      const { booking } = await heldBooking(flight, [
        adult(),
        child(),
        infant(),
      ]);
      expect(booking.status).toBe('PENDING_PAYMENT');
      expect(booking.statusLabel).toBe('Pending Payment');
      expect(booking.reference).toBeNull();
      expect(booking.seats).toBe(2);
      const expires = new Date(booking.holdExpiresAt!).getTime();
      expect(expires - before).toBeGreaterThan(10 * 60_000 - 5_000);
      expect(expires - before).toBeLessThan(10 * 60_000 + 5_000);
      const cabin = await cabinOf(flight);
      expect(cabin.heldSeats).toBe(2);
      expect((await flights.findById(flight._id).lean())!.everBooked).toBe(
        true,
      );
    });

    it('never oversells the last seat', async () => {
      const flight = await makeFlight({ seats: 1 });
      const clients = await Promise.all(
        Array.from({ length: 5 }, () => loggedInAs()),
      );
      const results = await Promise.all(
        clients.map(({ client }) => hold(client, bookingBody(flight))),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      results
        .filter((r) => r.status === 409)
        .forEach((r) =>
          expect((r.body as ErrorBody).code).toBe('SEATS_UNAVAILABLE'),
        );
      expect((await cabinOf(flight)).heldSeats).toBe(1);
      expect(
        await bookings.countDocuments({ 'segments.flight': flight._id }),
      ).toBe(1);

      const search = await request(ctx.server)
        .get('/api/flights/search')
        .query({
          from: 'CAI',
          to: 'DXB',
          date: flight.departureLocalDate,
          adults: 1,
        })
        .expect(200);
      const items = (search.body as { outbound: { items: { id: string }[] } })
        .outbound.items;
      expect(items.map((i) => i.id)).not.toContain(flight.id);
    });

    it('is all or nothing for a round trip', async () => {
      const outbound = await makeFlight({ departInDays: 40 });
      const back = await makeFlight({
        from: 'DXB',
        to: 'CAI',
        departInDays: 45,
        seats: 1,
      });
      await flights.updateOne(
        { _id: back._id },
        { $set: { 'cabins.0.bookedSeats': 1 } },
      );
      const { client } = await loggedInAs();
      const res = await hold(
        client,
        bookingBody(outbound, [adult()], {
          return: { flightId: back.id, cabinClass: 'Economy' },
        }),
      ).expect(409);
      expect((res.body as ErrorBody).code).toBe('SEATS_UNAVAILABLE');
      expect((await cabinOf(outbound)).heldSeats).toBe(0);
      expect(
        await bookings.countDocuments({ 'segments.flight': outbound._id }),
      ).toBe(0);
    });

    it('holds both flights of a round trip as one booking', async () => {
      const outbound = await makeFlight({ departInDays: 40, price: 200 });
      const back = await makeFlight({
        from: 'DXB',
        to: 'CAI',
        departInDays: 45,
        price: 150,
      });
      const { booking } = await heldBooking(outbound, [adult()], {
        return: { flightId: back.id, cabinClass: 'Economy' },
      });
      expect(booking.segments.map((s) => s.flightId)).toEqual([
        outbound.id,
        back.id,
      ]);
      expect(booking.price.total).toBe(350);
      expect(booking.price.perSegment).toEqual([200, 150]);
      expect((await cabinOf(outbound)).heldSeats).toBe(1);
      expect((await cabinOf(back)).heldSeats).toBe(1);
    });

    it('cannot hold seats on a cancelled flight', async () => {
      const flight = await makeFlight();
      await flights.updateOne(
        { _id: flight._id },
        { $set: { status: FlightStatus.CANCELLED } },
      );
      const { client } = await loggedInAs();
      const res = await hold(client, bookingBody(flight)).expect(400);
      expect((res.body as ErrorBody).errors?.[0].field).toBe(
        'outbound.flightId',
      );
    });

    it('keeps the airline from cutting seats below those held', async () => {
      const flight = await makeFlight({ seats: 2 });
      await heldBooking(flight, [adult(), adult({ fullName: 'Sara Adel' })]);
      const { client } = await moderator();
      const res = await client
        .patch(
          `/api/flights/${flight.id}/cabins/${flight.cabins[0]._id.toString()}`,
        )
        .send({ seats: 1 })
        .expect(409);
      expect((res.body as ErrorBody).code).toBe('SEATS_BELOW_BOOKED');
    });

    it('locks the airports once seats are held', async () => {
      const flight = await makeFlight();
      await heldBooking(flight);
      const { client } = await moderator();
      const res = await client
        .patch(`/api/flights/${flight.id}`)
        .send({ arrivalAirport: 'JED' })
        .expect(409);
      expect((res.body as ErrorBody).code).toBe('AIRPORTS_LOCKED');
    });
  });
  describe('hold expiry and completion (FLT-22, GEN-11, PAY-01)', () => {
    const expiry = () => ctx.moduleRef.get(FlightBookingExpiryService);
    const pastDue = (id: string) =>
      bookings.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1_000) } },
      );

    it('expires an unpaid hold and releases its seats', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight, [adult(), child()]);
      await pastDue(booking.id);
      expect(await expiry().expireDue()).toBe(1);
      const doc = await bookings.findById(booking.id).lean();
      expect(doc!.status).toBe('EXPIRED');
      expect(doc!.expiredAt).toBeInstanceOf(Date);
      expect((await cabinOf(flight)).heldSeats).toBe(0);
      expect(paymentService.cancelPendingPayment).toHaveBeenCalledWith(
        'flight',
        booking.id,
      );
    });

    it('is safe when two sweeps run at once', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      await pastDue(booking.id);
      const [a, b] = await Promise.all([
        expiry().expireDue(),
        expiry().expireDue(),
      ]);
      expect(a + b).toBe(1);
      expect((await cabinOf(flight)).heldSeats).toBe(0);
    });

    it('leaves a live hold alone', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      expect(await expiry().expireDue()).toBe(0);
      expect((await bookings.findById(booking.id).lean())!.status).toBe(
        'PENDING_PAYMENT',
      );
    });

    it('completes a confirmed booking once its last flight has landed', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      await bookings.updateOne(
        { _id: new Types.ObjectId(booking.id) },
        { $set: { status: 'CONFIRMED' } },
      );
      await flights.updateOne(
        { _id: flight._id },
        {
          $set: {
            departureUtc: new Date(Date.now() - 5 * 3_600_000),
            arrivalUtc: new Date(Date.now() - 1 * 3_600_000),
          },
        },
      );
      expect(await expiry().completeDue()).toBeGreaterThanOrEqual(1);
      const doc = await bookings.findById(booking.id).lean();
      expect(doc!.status).toBe('COMPLETED');
      expect(doc!.completedAt).toBeInstanceOf(Date);
    });
  });
  describe('payments API for the payments module (PAY-01, PAY-02, FLT-23)', () => {
    const payments = () => ctx.moduleRef.get(FlightBookingPayments);
    const paid = (booking: BookingBody, overrides: object = {}) => ({
      paymentIntentId: `pi_${booking.id}`,
      amount: booking.price.total,
      currency: 'USD',
      ...overrides,
    });

    it('confirms a paid hold, books the seats and creates a reference', async () => {
      const flight = await makeFlight();
      const { user, booking } = await heldBooking(flight, [adult(), child()]);
      const result = await payments().confirmPaid(booking.id, paid(booking));
      expect(result.outcome).toBe('confirmed');
      const doc = await bookings.findById(booking.id).lean();
      expect(doc!.status).toBe('CONFIRMED');
      expect(doc!.reference).toMatch(/^FB-[A-HJ-NP-Z2-9]{8}$/);
      expect(doc!.payment).toMatchObject({
        paymentIntentId: `pi_${booking.id}`,
        amount: booking.price.total,
        status: 'SUCCEEDED',
      });
      const cabin = await cabinOf(flight);
      expect(cabin.heldSeats).toBe(0);
      expect(cabin.bookedSeats).toBe(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        user.id,
        'FLIGHT_BOOKING_CONFIRMED',
        expect.stringContaining(doc!.reference!),
      );
    });

    it('is idempotent for the same payment', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      await payments().confirmPaid(booking.id, paid(booking));
      const again = await payments().confirmPaid(booking.id, paid(booking));
      expect(again.outcome).toBe('already_confirmed');
      expect((await cabinOf(flight)).bookedSeats).toBe(1);
    });

    it('rejects a payment that arrives after the hold expired', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      await bookings.updateOne(
        { _id: new Types.ObjectId(booking.id) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1_000) } },
      );
      const result = await payments().confirmPaid(booking.id, paid(booking));
      expect(result).toEqual({ outcome: 'rejected', reason: 'HOLD_EXPIRED' });
      expect((await bookings.findById(booking.id).lean())!.status).toBe(
        'EXPIRED',
      );
      expect((await cabinOf(flight)).heldSeats).toBe(0);
    });

    it('rejects a payment with the wrong amount', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      const result = await payments().confirmPaid(
        booking.id,
        paid(booking, { amount: booking.price.total - 1 }),
      );
      expect(result).toEqual({
        outcome: 'rejected',
        reason: 'AMOUNT_MISMATCH',
      });
      expect((await cabinOf(flight)).heldSeats).toBe(1);
    });

    it('rejects a payment once the flight has departed', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      await flights.updateOne(
        { _id: flight._id },
        { $set: { departureUtc: new Date(Date.now() - 60_000) } },
      );
      const result = await payments().confirmPaid(booking.id, paid(booking));
      expect(result).toEqual({
        outcome: 'rejected',
        reason: 'FLIGHT_NOT_BOOKABLE',
      });
      expect((await cabinOf(flight)).heldSeats).toBe(0);
    });

    it('gives the amount to charge only to the booking owner', async () => {
      const flight = await makeFlight();
      const { user, booking } = await heldBooking(flight);
      const payable = await payments().forPayment(booking.id, user.id);
      expect(payable).toMatchObject({
        bookingId: booking.id,
        amount: booking.price.total,
        currency: 'USD',
        paymentIntentId: null,
      });
      const stranger = await loggedInAs();
      await expect(
        payments().forPayment(booking.id, stranger.id),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('records the PaymentIntent and a failed attempt without ending the hold', async () => {
      const flight = await makeFlight();
      const { user, booking } = await heldBooking(flight);
      await payments().attachPaymentIntent(booking.id, 'pi_retry');
      await payments().recordPaymentFailure(booking.id);
      const doc = await bookings.findById(booking.id).lean();
      expect(doc!.status).toBe('PENDING_PAYMENT');
      expect(doc!.payment).toMatchObject({
        paymentIntentId: 'pi_retry',
        status: 'FAILED',
      });
      expect(
        (await payments().forPayment(booking.id, user.id)).paymentIntentId,
      ).toBe('pi_retry');
    });

    it('returns the policies the user accepts (PAY-02)', async () => {
      const flight = await makeFlight();
      const { user, booking } = await heldBooking(flight);
      expect(await payments().policiesFor(booking.id, user.id)).toEqual({
        cancellationTiers: [
          { daysBefore: 30, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
        ],
        baggagePolicy: { extraBagPrice: 30, maxExtraBags: 2 },
        freeBags: [1],
        maxBagWeightKg: [23],
      });
    });
  });
  describe('my bookings and details (FLT-25)', () => {
    const setStatus = (id: string, status: string) =>
      bookings.updateOne({ _id: new Types.ObjectId(id) }, { $set: { status } });

    it('groups my bookings as upcoming, past and cancelled', async () => {
      const flight = await makeFlight();
      const user = await loggedInAs();
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await hold(user.client, bookingBody(flight)).expect(201);
        ids.push((res.body as BookingBody).id);
      }
      await setStatus(ids[1], 'CONFIRMED');
      await setStatus(ids[2], 'EXPIRED');
      await setStatus(ids[3], 'CANCELLED');
      // Someone else's booking never shows up.
      await heldBooking(flight);

      const list = async (group: string) =>
        (
          await user.client
            .get('/api/flight-bookings')
            .query({ group })
            .expect(200)
        ).body as {
          items: BookingBody[];
          total: number;
          page: number;
          limit: number;
        };

      const upcoming = await list('upcoming');
      expect(upcoming).toMatchObject({ total: 2, page: 1, limit: 10 });
      expect(upcoming.items.map((b) => b.id).sort()).toEqual(
        [ids[0], ids[1]].sort(),
      );
      expect((await list('past')).items.map((b) => b.id)).toEqual([ids[2]]);
      expect((await list('cancelled')).items.map((b) => b.id)).toEqual([
        ids[3],
      ]);
    });

    it('moves a hold that ran out to past when listing', async () => {
      const flight = await makeFlight();
      const user = await loggedInAs();
      const res = await hold(user.client, bookingBody(flight)).expect(201);
      const id = (res.body as BookingBody).id;
      await bookings.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { holdExpiresAt: new Date(Date.now() - 1_000) } },
      );
      const past = await user.client
        .get('/api/flight-bookings')
        .query({ group: 'past' })
        .expect(200);
      expect((past.body as { items: BookingBody[] }).items[0]).toMatchObject({
        id,
        status: 'EXPIRED',
      });
      expect((await cabinOf(flight)).heldSeats).toBe(0);
    });

    it('shows details in local time with the refund preview', async () => {
      const flight = await makeFlight({ departInDays: 40 });
      const { user, booking } = await heldBooking(flight);
      await setStatus(booking.id, 'CONFIRMED');
      const res = await user.client
        .get(`/api/flight-bookings/${booking.id}`)
        .expect(200);
      const body = res.body as BookingBody;
      expect(body.segments[0].departure.localTime).toBe(
        utcToLocal(flight.departureUtc, 'Africa/Cairo').time,
      );
      expect(body.cancellation).toMatchObject({
        refundPercent: 100,
        refundAmount: booking.price.total,
      });
    });

    it('hides a booking from other users and moderators but not admins', async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      const stranger = await loggedInAs();
      await stranger.client
        .get(`/api/flight-bookings/${booking.id}`)
        .expect(404);
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client.get(`/api/flight-bookings/${booking.id}`).expect(200);
      const mod = await moderator();
      await mod.client.get(`/api/flight-bookings/${booking.id}`).expect(403);
      await stranger.client.get('/api/flight-bookings/not-an-id').expect(404);
    });
  });
  describe('cancellation and the airline cancelling a flight (FLT-26, FLT-06, FLT-29, PAY-03)', () => {
    /** A Confirmed booking through the real payment path. */
    async function confirmedBooking(
      flight: FlightDocument,
      passengers: object[] = [adult()],
      extra: Record<string, unknown> = {},
    ) {
      const held = await heldBooking(flight, passengers, extra);
      const result = await ctx.moduleRef
        .get(FlightBookingPayments)
        .confirmPaid(held.booking.id, {
          paymentIntentId: `pi_${held.booking.id}`,
          amount: held.booking.price.total,
          currency: 'USD',
        });
      expect(result.outcome).toBe('confirmed');
      return held;
    }
    const cancel = (client: Client, id: string, body: object = {}) =>
      client.post(`/api/flight-bookings/${id}/cancel`).send(body);

    it('shows the refund without cancelling when not confirmed', async () => {
      const flight = await makeFlight({ departInDays: 40 });
      const { user, booking } = await confirmedBooking(flight);
      const res = await cancel(user.client, booking.id).expect(200);
      expect(res.body).toMatchObject({
        cancelled: false,
        preview: { refundPercent: 100, refundAmount: booking.price.total },
      });
      expect((await bookings.findById(booking.id).lean())!.status).toBe(
        'CONFIRMED',
      );
    });

    it('cancels by the airline tier, returns the seats and issues the refund', async () => {
      const flight = await makeFlight({ departInDays: 10.5, price: 200 });
      const { user, booking } = await confirmedBooking(flight);
      const res = await cancel(user.client, booking.id, {
        confirm: true,
      }).expect(200);
      const body = res.body as { cancelled: boolean; booking: BookingBody };
      expect(body.cancelled).toBe(true);
      expect(body.booking.status).toBe('CANCELLED');
      const doc = await bookings.findById(booking.id).lean();
      expect(doc!.refund).toMatchObject({
        percent: 50,
        amount: 100,
        status: 'REFUNDED',
        refundId: `re_${booking.id}`,
      });
      expect(doc!.cancelledBy).toBe('user');
      expect((await cabinOf(flight)).bookedSeats).toBe(0);
      expect(refundService.issue).toHaveBeenCalledWith('flight', booking.id);
      expect(notifications.notify).toHaveBeenCalledWith(
        user.id,
        'FLIGHT_BOOKING_CANCELLED',
        expect.any(String),
      );
    });

    it('keeps the refund Pending when the refund service fails', async () => {
      const flight = await makeFlight({ departInDays: 40 });
      const { user, booking } = await confirmedBooking(flight);
      refundService.issue.mockRejectedValueOnce(new Error('Stripe down'));
      await cancel(user.client, booking.id, { confirm: true }).expect(200);
      const doc = await bookings.findById(booking.id).lean();
      expect(doc!.status).toBe('CANCELLED');
      expect(doc!.refund).toMatchObject({ percent: 100, status: 'PENDING' });
    });

    it('blocks cancellation after departure', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmedBooking(flight);
      await flights.updateOne(
        { _id: flight._id },
        { $set: { departureUtc: new Date(Date.now() - 60_000) } },
      );
      const res = await cancel(user.client, booking.id, {
        confirm: true,
      }).expect(409);
      expect((res.body as ErrorBody).code).toBe('ALREADY_DEPARTED');
    });

    it("cannot cancel someone else's booking", async () => {
      const flight = await makeFlight();
      const { booking } = await confirmedBooking(flight);
      const stranger = await loggedInAs();
      await cancel(stranger.client, booking.id, { confirm: true }).expect(404);
    });

    it('cancels and refunds every booking when the airline cancels the flight', async () => {
      const flight = await makeFlight();
      const confirmed = await confirmedBooking(flight);
      const pending = await heldBooking(flight);
      const { client } = await moderator();
      const res = await client
        .post(`/api/flights/${flight.id}/cancel`)
        .send({ confirm: true })
        .expect(201);
      expect(
        (res.body as { cancelledBookings: number }).cancelledBookings,
      ).toBe(1);

      const cancelledDoc = await bookings.findById(confirmed.booking.id).lean();
      expect(cancelledDoc!.status).toBe('CANCELLED');
      expect(cancelledDoc!.cancelledBy).toBe('airline');
      expect(cancelledDoc!.refund).toMatchObject({
        percent: 100,
        amount: confirmed.booking.price.total,
      });
      expect((await bookings.findById(pending.booking.id).lean())!.status).toBe(
        'EXPIRED',
      );
      const cabin = await cabinOf(flight);
      expect(cabin.bookedSeats).toBe(0);
      expect(cabin.heldSeats).toBe(0);
      expect(notifications.notify).toHaveBeenCalledWith(
        confirmed.user.id,
        'FLIGHT_CANCELLED',
        expect.any(String),
      );

      const link = ctx.moduleRef.get(FlightBookingHooks).get()!;
      expect(await link.cancelBookingsForFlight(flight.id)).toEqual({
        cancelled: 0,
        notifiedUserIds: [],
      });
    });

    it("lists the flight's bookings for its airline (FLT-29)", async () => {
      const flight = await makeFlight();
      const { booking } = await confirmedBooking(flight, [
        adult({ fullName: 'Layla Hassan' }),
      ]);
      const { client } = await moderator();
      const res = await client
        .get(`/api/flights/${flight.id}/bookings`)
        .expect(200);
      const items = (
        res.body as {
          bookings: {
            items: {
              reference: string;
              passengerNames: string[];
              status: string;
              seats: number;
            }[];
          };
        }
      ).bookings.items;
      const doc = await bookings.findById(booking.id).lean();
      expect(items).toEqual([
        expect.objectContaining({
          reference: doc!.reference,
          passengerNames: ['Layla Hassan'],
          status: 'Confirmed',
          seats: 1,
        }),
      ]);
      const csv = await client
        .get(`/api/flights/${flight.id}/passengers/export`)
        .expect(200);
      expect(csv.text).toContain('Layla Hassan');
    });

    it('tells the flights module who to notify about a schedule change (FLT-05)', async () => {
      const flight = await makeFlight();
      const { user } = await confirmedBooking(flight);
      await heldBooking(flight);
      const link = ctx.moduleRef.get(FlightBookingHooks).get()!;
      expect(await link.getConfirmedPassengerUserIds(flight.id)).toEqual([
        user.id,
      ]);
    });
  });
  describe('e-ticket (FLT-23, GEN-06)', () => {
    it('downloads a PDF e-ticket for a confirmed booking', async () => {
      const flight = await makeFlight();
      const { user, booking } = await heldBooking(flight);
      await ctx.moduleRef.get(FlightBookingPayments).confirmPaid(booking.id, {
        paymentIntentId: `pi_${booking.id}`,
        amount: booking.price.total,
        currency: 'USD',
      });
      const res = await user.client
        .get(`/api/flight-bookings/${booking.id}/e-ticket`)
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="FB-[A-HJ-NP-Z2-9]{8}\.pdf"/,
      );
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });

    it('has no e-ticket before payment', async () => {
      const flight = await makeFlight();
      const { user, booking } = await heldBooking(flight);
      const res = await user.client
        .get(`/api/flight-bookings/${booking.id}/e-ticket`)
        .expect(409);
      expect((res.body as ErrorBody).code).toBe('TICKET_NOT_AVAILABLE');
    });

    it("cannot download someone else's e-ticket", async () => {
      const flight = await makeFlight();
      const { booking } = await heldBooking(flight);
      const stranger = await loggedInAs();
      await stranger.client
        .get(`/api/flight-bookings/${booking.id}/e-ticket`)
        .expect(404);
    });
  });
});
