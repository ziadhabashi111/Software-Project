import { Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { FlightBookingsModule } from '../src/flight-bookings/flight-bookings.module';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../src/flight-bookings/schemas/flight-booking.schema';
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
});
