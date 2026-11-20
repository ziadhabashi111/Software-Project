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
import { SeatAssignments } from '../src/flight-bookings/seat-assignments';
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
import {
  REFUND_SERVICE,
  type RefundResult,
} from '../src/payments/refund.service.interface';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const DAY = 86_400_000;

interface ErrorBody {
  code?: string;
  errors?: { field: string }[];
}

interface BookingBody {
  id: string;
  status: string;
  price: { total: number };
  passengers: { fullName: string; seats: (string | null)[] }[];
}

interface SeatMap {
  flightId: string;
  cabinClass: string;
  seatsPerRow: number;
  rows: { row: number; seats: { label: string; taken: boolean }[] }[];
}

const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
const paymentService = {
  cancelPendingPayment: jest.fn().mockResolvedValue(undefined),
};
const refundService = {
  preview: jest.fn(),
  issue: jest.fn((_type: string, id: string): Promise<RefundResult> =>
    Promise.resolve({
      refundId: `re_${id}`,
      amount: 0,
      status: 'REFUNDED',
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

describe('Seat selection (FLT-28; real flights module, MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let flights: Model<FlightDocument>;
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
    bookings = ctx.moduleRef.get(getModelToken(FlightBooking.name));
    const airlines: Model<AirlineDocument> = ctx.moduleRef.get(
      getModelToken(Airline.name),
    );
    const airports: Model<AirportDocument> = ctx.moduleRef.get(
      getModelToken(Airport.name),
    );
    await Promise.all([
      flights.syncIndexes(),
      bookings.syncIndexes(),
      ctx.moduleRef.get(SeatAssignments).syncIndexes(),
    ]);
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
      cancellationPolicy: [{ daysBefore: 7, refundPercent: 50 }],
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(role: Role = Role.USER, providerId?: string) {
    counter += 1;
    const email = `seat${counter}@example.com`;
    const doc = await users.create({
      name: `Seat ${counter}`,
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
  type User = Awaited<ReturnType<typeof loggedInAs>>;

  /** A Scheduled flight with a 10-seat Economy cabin (rows 1A-1F, 2A-2D). */
  async function makeFlight(departInDays = 40): Promise<FlightDocument> {
    flightCounter += 1;
    const departureUtc = new Date(Date.now() + departInDays * DAY);
    return flights.create({
      airlineId: airline._id,
      flightNumber: `NA${500 + flightCounter}`,
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureUtc,
      arrivalUtc: new Date(departureUtc.getTime() + 3.5 * 3_600_000),
      departureLocalDate: utcToLocal(departureUtc, 'Africa/Cairo').date,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          cabinClass: CabinClass.ECONOMY,
          totalSeats: 10,
          price: 200,
          freeBags: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
  }

  const adult = (name = 'Mona Adel') => ({
    fullName: name,
    dateOfBirth: '1990-05-01',
    documentNumber: 'A1234567',
    type: 'adult',
  });
  const infant = () => ({
    fullName: 'Baby Adel',
    dateOfBirth: new Date(Date.now() - 200 * DAY).toISOString().slice(0, 10),
    documentNumber: 'B7654321',
    type: 'infant',
  });

  async function held(
    flight: FlightDocument,
    passengers: object[] = [adult()],
    user?: User,
  ): Promise<{ user: User; booking: BookingBody }> {
    const owner = user ?? (await loggedInAs());
    const res = await owner.client
      .post('/api/flight-bookings/hold')
      .send({
        outbound: { flightId: flight.id, cabinClass: 'Economy' },
        passengers,
      })
      .expect(201);
    return { user: owner, booking: res.body as BookingBody };
  }

  async function confirmed(
    flight: FlightDocument,
    passengers: object[] = [adult()],
  ): Promise<{ user: User; booking: BookingBody }> {
    const result = await held(flight, passengers);
    await ctx.moduleRef
      .get(FlightBookingPayments)
      .confirmPaid(result.booking.id, {
        paymentIntentId: `pi_${result.booking.id}`,
        amount: result.booking.price.total,
        currency: 'USD',
      });
    return result;
  }

  const pick = (
    user: User,
    bookingId: string,
    body: { passengerIndex: number; seat: string; segmentIndex?: number },
  ) => user.client.patch(`/api/flight-bookings/${bookingId}/seat`).send(body);

  async function seatMap(flight: FlightDocument): Promise<SeatMap> {
    const res = await request(ctx.server)
      .get(`/api/flights/${flight.id}/seats`)
      .query({ cabinClass: 'Economy' })
      .expect(200);
    return res.body as SeatMap;
  }
  const taken = (map: SeatMap) =>
    map.rows.flatMap((r) => r.seats.filter((s) => s.taken).map((s) => s.label));

  describe('seat map', () => {
    it('is public and lists every seat by row with no personal data', async () => {
      const flight = await makeFlight();
      const map = await seatMap(flight);
      expect(map).toMatchObject({
        flightId: flight.id,
        cabinClass: 'Economy',
        seatsPerRow: 6,
      });
      expect(map.rows.map((r) => r.seats.map((s) => s.label))).toEqual([
        ['1A', '1B', '1C', '1D', '1E', '1F'],
        ['2A', '2B', '2C', '2D'],
      ]);
      expect(taken(map)).toEqual([]);
    });

    it('answers 404 for an unknown flight or a cabin the flight does not have', async () => {
      await request(ctx.server)
        .get(`/api/flights/${new Types.ObjectId().toHexString()}/seats`)
        .query({ cabinClass: 'Economy' })
        .expect(404);
      const flight = await makeFlight();
      await request(ctx.server)
        .get(`/api/flights/${flight.id}/seats`)
        .query({ cabinClass: 'Business' })
        .expect(404);
    });
  });

  describe('picking a seat', () => {
    it('assigns the seat, shows it on the booking and on the map, and moves it when picked again', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      const res = await pick(user, booking.id, {
        passengerIndex: 0,
        seat: '2c',
      }).expect(200);
      expect((res.body as BookingBody).passengers[0].seats).toEqual(['2C']);
      expect(taken(await seatMap(flight))).toEqual(['2C']);

      await pick(user, booking.id, { passengerIndex: 0, seat: '1A' }).expect(
        200,
      );
      expect(taken(await seatMap(flight))).toEqual(['1A']);
      const details = await user.client
        .get(`/api/flight-bookings/${booking.id}`)
        .expect(200);
      expect((details.body as BookingBody).passengers[0].seats).toEqual(['1A']);
    });

    it('shows not selected (null) until a seat is picked, and never for infants', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight, [adult(), infant()]);
      const details = await user.client
        .get(`/api/flight-bookings/${booking.id}`)
        .expect(200);
      expect(
        (details.body as BookingBody).passengers.map((p) => p.seats),
      ).toEqual([[null], [null]]);
      const res = await pick(user, booking.id, {
        passengerIndex: 1,
        seat: '1B',
      }).expect(400);
      expect((res.body as ErrorBody).errors?.[0]?.field).toBe('passengerIndex');
    });

    it('refuses a seat the cabin does not have, a missing passenger or segment', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      for (const seat of ['2E', '9A', 'ZZ']) {
        const res = await pick(user, booking.id, {
          passengerIndex: 0,
          seat,
        }).expect(400);
        expect((res.body as ErrorBody).errors?.[0]?.field).toBe('seat');
      }
      await pick(user, booking.id, { passengerIndex: 3, seat: '1A' }).expect(
        400,
      );
      await pick(user, booking.id, {
        passengerIndex: 0,
        seat: '1A',
        segmentIndex: 1,
      }).expect(400);
    });

    it('is only for the owner, and only once the booking is Confirmed', async () => {
      const flight = await makeFlight();
      const { booking } = await confirmed(flight);
      const stranger = await loggedInAs();
      await pick(stranger, booking.id, {
        passengerIndex: 0,
        seat: '1A',
      }).expect(404);

      const pending = await held(flight);
      const res = await pick(pending.user, pending.booking.id, {
        passengerIndex: 0,
        seat: '1A',
      }).expect(409);
      expect((res.body as ErrorBody).code).toBe('NOT_CONFIRMED');
    });

    it('refuses once the flight is cancelled or has departed', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      await flights.updateOne(
        { _id: flight._id },
        { departureUtc: new Date(Date.now() - 60_000) },
      );
      const res = await pick(user, booking.id, {
        passengerIndex: 0,
        seat: '1A',
      }).expect(409);
      expect((res.body as ErrorBody).code).toBe('SEAT_CHANGE_CLOSED');
    });

    it('gives a seat to one passenger only: 409 SEAT_TAKEN, even for parallel picks', async () => {
      const flight = await makeFlight();
      const first = await confirmed(flight);
      const second = await confirmed(flight);
      await pick(first.user, first.booking.id, {
        passengerIndex: 0,
        seat: '1C',
      }).expect(200);
      const res = await pick(second.user, second.booking.id, {
        passengerIndex: 0,
        seat: '1C',
      }).expect(409);
      expect((res.body as ErrorBody).code).toBe('SEAT_TAKEN');

      const racers = await Promise.all(
        Array.from({ length: 4 }, () => confirmed(flight)),
      );
      const results = await Promise.all(
        racers.map((r) =>
          pick(r.user, r.booking.id, { passengerIndex: 0, seat: '2A' }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(taken(await seatMap(flight)).sort()).toEqual(['1C', '2A']);
    });
  });

  describe('seats are released', () => {
    it('when the user cancels the booking', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      await pick(user, booking.id, { passengerIndex: 0, seat: '1D' }).expect(
        200,
      );
      await user.client
        .post(`/api/flight-bookings/${booking.id}/cancel`)
        .send({ confirm: true })
        .expect(200);
      expect(taken(await seatMap(flight))).toEqual([]);
    });

    it('never seats a passenger on a booking cancelled while the pick runs', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      // The pick read the booking while it was still Confirmed ...
      const stale = await bookings.findById(booking.id);
      await user.client
        .post(`/api/flight-bookings/${booking.id}/cancel`)
        .send({ confirm: true })
        .expect(200);
      // ... and only reaches its transaction after the cancel committed.
      const findById = jest
        .spyOn(bookings, 'findById')
        .mockResolvedValueOnce(stale);
      try {
        const res = await user.client
          .patch(`/api/flight-bookings/${booking.id}/seat`)
          .send({ passengerIndex: 0, seat: '1A' })
          .expect(409);
        expect((res.body as { code?: string }).code).toBe('NOT_CONFIRMED');
      } finally {
        findById.mockRestore();
      }
      expect(taken(await seatMap(flight))).toEqual([]);
    });

    it('when the airline cancels the flight', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      await pick(user, booking.id, { passengerIndex: 0, seat: '1E' }).expect(
        200,
      );
      const mod = await loggedInAs(Role.AIRLINE_MODERATOR, airline.id);
      await mod.client
        .post(`/api/flights/${flight.id}/cancel`)
        .send({ confirm: true })
        .expect(201);
      const assignments = ctx.moduleRef.get(SeatAssignments);
      expect(
        await assignments.takenSeats(flight.id, CabinClass.ECONOMY),
      ).toEqual([]);
    });

    it('through the release API used by other booking flows', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      await pick(user, booking.id, { passengerIndex: 0, seat: '2B' }).expect(
        200,
      );
      const assignments = ctx.moduleRef.get(SeatAssignments);
      await assignments.releaseSegment(booking.id, 0);
      expect(taken(await seatMap(flight))).toEqual([]);

      await pick(user, booking.id, { passengerIndex: 0, seat: '2B' }).expect(
        200,
      );
      await assignments.releaseBooking(booking.id);
      expect(taken(await seatMap(flight))).toEqual([]);
    });

    it('expiring a hold leaves no seats behind', async () => {
      const flight = await makeFlight();
      const { booking } = await held(flight);
      await bookings.updateOne(
        { _id: booking.id },
        { holdExpiresAt: new Date(Date.now() - 1000) },
      );
      await ctx.moduleRef
        .get(FlightBookingExpiryService)
        .expireOne(new Types.ObjectId(booking.id));
      expect(taken(await seatMap(flight))).toEqual([]);
    });
  });

  describe("the airline's cabin layout (FLT-04, FLT-05)", () => {
    it('sets seats per row on a new cabin and validates it', async () => {
      const flight = await makeFlight();
      const mod = await loggedInAs(Role.AIRLINE_MODERATOR, airline.id);
      await mod.client
        .post(`/api/flights/${flight.id}/cabins`)
        .send({
          cabinClass: 'Business',
          seats: 8,
          price: 900,
          freeBags: 2,
          maxBagWeightKg: 32,
          seatsPerRow: 11,
        })
        .expect(400);
      await mod.client
        .post(`/api/flights/${flight.id}/cabins`)
        .send({
          cabinClass: 'Business',
          seats: 8,
          price: 900,
          freeBags: 2,
          maxBagWeightKg: 32,
          seatsPerRow: 2,
        })
        .expect(201);
      const res = await request(ctx.server)
        .get(`/api/flights/${flight.id}/seats`)
        .query({ cabinClass: 'Business' })
        .expect(200);
      expect((res.body as SeatMap).rows).toHaveLength(4);
    });

    it('refuses a change that would remove an assigned seat or reshape a cabin with assignments (409 SEATS_ASSIGNED)', async () => {
      const flight = await makeFlight();
      const { user, booking } = await confirmed(flight);
      await pick(user, booking.id, { passengerIndex: 0, seat: '2C' }).expect(
        200,
      );
      const cabinId = (await flights.findById(flight._id))!.cabins[0]._id;
      const mod = await loggedInAs(Role.AIRLINE_MODERATOR, airline.id);
      const url = `/api/flights/${flight.id}/cabins/${cabinId.toString()}`;

      const shrink = await mod.client.patch(url).send({ seats: 8 }).expect(409);
      expect((shrink.body as ErrorBody).code).toBe('SEATS_ASSIGNED');
      const reshape = await mod.client
        .patch(url)
        .send({ seatsPerRow: 4 })
        .expect(409);
      expect((reshape.body as ErrorBody).code).toBe('SEATS_ASSIGNED');

      // 2C is still there with 9 seats, and more seats never remove one.
      await mod.client.patch(url).send({ seats: 9 }).expect(200);
      await mod.client.patch(url).send({ seats: 12 }).expect(200);
    });
  });
});
