import { Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
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

jest.setTimeout(60_000);

const PASSWORD = 'Passw0rdOk';
const DAY = 86_400_000;

interface BookingBody {
  id: string;
  price: { total: number };
}

interface CancelBody {
  flight: { status: string };
  cancelledBookings: number;
  notifiedPassengers: number;
}

/** Stand-ins for Ziad's notification, payment and refund services (not built yet). */
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

/**
 * The flights module and the REAL flight-bookings module together, with no
 * fake hook: cancelling a flight (FLT-06) reaches Yahia's
 * `cancelBookingsForFlight` through `FlightBookingHooks`.
 */
describe('Cancelling a flight with real bookings (FLT-06, PAY-03; flights + flight-bookings, MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let flights: Model<FlightDocument>;
  let bookings: Model<FlightBookingDocument>;
  let airline: AirlineDocument;
  let userCounter = 0;
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
    // A user cancelling a week out would get only 10%: a 100% refund below
    // can therefore only come from the "airline cancelled the flight" rule.
    airline = await airlines.create({
      name: 'Nile Air',
      code: 'NA',
      cancellationPolicy: [{ daysBefore: 0, refundPercent: 10 }],
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function loggedInAs(role: Role = Role.USER, providerId?: string) {
    userCounter += 1;
    const email = `cascade${userCounter}@example.com`;
    const doc = await users.create({
      name: `Traveller ${userCounter}`,
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

  type Traveller = Awaited<ReturnType<typeof loggedInAs>>;

  async function makeFlight(seats = 20): Promise<FlightDocument> {
    flightCounter += 1;
    const departureUtc = new Date(Date.now() + 40 * DAY);
    return flights.create({
      airlineId: airline._id,
      flightNumber: `NA${300 + flightCounter}`,
      departureAirport: 'CAI',
      arrivalAirport: 'DXB',
      departureUtc,
      arrivalUtc: new Date(departureUtc.getTime() + 3.5 * 3_600_000),
      departureLocalDate: utcToLocal(departureUtc, 'Africa/Cairo').date,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          cabinClass: CabinClass.ECONOMY,
          totalSeats: seats,
          price: 200,
          freeBags: 1,
          maxBagWeightKg: 23,
        },
      ],
    });
  }

  const adult = (name: string, document: string) => ({
    fullName: name,
    dateOfBirth: '1990-05-01',
    documentNumber: document,
    type: 'adult',
  });

  /** A held booking (Pending Payment) for `user`: the seats are held. */
  async function hold(
    user: Traveller,
    flight: FlightDocument,
    passengers: object[],
  ): Promise<BookingBody> {
    const res = await user.client
      .post('/api/flight-bookings/hold')
      .send({
        outbound: { flightId: flight.id, cabinClass: 'Economy' },
        passengers,
      })
      .expect(201);
    return res.body as BookingBody;
  }

  /** A Confirmed booking through the real payment path. */
  async function confirmed(
    user: Traveller,
    flight: FlightDocument,
    passengers: object[],
  ): Promise<BookingBody> {
    const booking = await hold(user, flight, passengers);
    const result = await ctx.moduleRef
      .get(FlightBookingPayments)
      .confirmPaid(booking.id, {
        paymentIntentId: `pi_${booking.id}`,
        amount: booking.price.total,
        currency: 'USD',
      });
    expect(result.outcome).toBe('confirmed');
    return booking;
  }

  const cabinCounters = async (flight: FlightDocument) => {
    const fresh = await flights.findById(flight._id).lean();
    const cabin = fresh?.cabins[0];
    return { booked: cabin?.bookedSeats, held: cabin?.heldSeats };
  };

  const cancelNotices = () =>
    notifications.notify.mock.calls.filter(
      (call: unknown[]) => call[1] === 'FLIGHT_CANCELLED',
    ) as [string, string, string][];

  it('refunds every Confirmed booking at 100%, expires the holds, frees the seats and notifies each affected traveller', async () => {
    const flight = await makeFlight();
    const mod = await loggedInAs(Role.AIRLINE_MODERATOR, airline.id);

    const ana = await loggedInAs();
    const omar = await loggedInAs();
    const sara = await loggedInAs();
    const holder = await loggedInAs();

    // Ana has TWO confirmed bookings on this flight (3 seats in all): one traveller, two bookings.
    const anaFirst = await confirmed(ana, flight, [
      adult('Ana One', 'A1000001'),
      adult('Ana Two', 'A1000002'),
    ]);
    const anaSecond = await confirmed(ana, flight, [
      adult('Ana Three', 'A1000003'),
    ]);
    const omarBooking = await confirmed(omar, flight, [
      adult('Omar Adel', 'B2000001'),
    ]);
    const saraBooking = await confirmed(sara, flight, [
      adult('Sara Adel', 'C3000001'),
    ]);
    // Unpaid: two seats held.
    const pending = await hold(holder, flight, [
      adult('Holder One', 'D4000001'),
      adult('Holder Two', 'D4000002'),
    ]);

    expect(await cabinCounters(flight)).toEqual({ booked: 5, held: 2 });

    const res = await mod.client
      .post(`/api/flights/${flight.id}/cancel`)
      .send({ confirm: true })
      .expect(201);
    const body = res.body as CancelBody;

    // The flight and the answer.
    expect(body.flight.status).toBe('Cancelled');
    expect(body.cancelledBookings).toBe(4);
    expect(body.notifiedPassengers).toBe(3); // Ana, Omar, Sara
    expect((await flights.findById(flight._id))?.status).toBe('Cancelled');

    // Confirmed bookings: Cancelled by the airline, refunded 100% (the policy alone would give 10%).
    for (const booking of [anaFirst, anaSecond, omarBooking, saraBooking]) {
      const doc = await bookings.findById(booking.id).lean();
      expect(doc?.status).toBe('CANCELLED');
      expect(doc?.cancelledBy).toBe('airline');
      expect(doc?.refund).toMatchObject({
        percent: 100,
        amount: booking.price.total,
      });
      expect(refundService.issue).toHaveBeenCalledWith('flight', booking.id);
    }
    expect(refundService.issue).toHaveBeenCalledTimes(4);

    // The unpaid hold expires and no refund is asked for it.
    expect((await bookings.findById(pending.id).lean())?.status).toBe(
      'EXPIRED',
    );
    expect(refundService.issue).not.toHaveBeenCalledWith('flight', pending.id);

    // Seats: booked and held both back to zero.
    expect(await cabinCounters(flight)).toEqual({ booked: 0, held: 0 });

    // Notices: one per cancelled booking, each naming its own booking (so Ana,
    // with two bookings, gets two), and the holder with the unpaid hold gets none.
    const notices = cancelNotices();
    expect(notices).toHaveLength(4);
    const references = await bookings
      .find({
        _id: {
          $in: [anaFirst.id, anaSecond.id, omarBooking.id, saraBooking.id],
        },
      })
      .lean();
    for (const doc of references) {
      const forThisBooking = notices.filter((call) =>
        call[2].includes(doc.reference ?? 'missing-reference'),
      );
      expect(forThisBooking).toHaveLength(1);
      expect(forThisBooking[0][0]).toBe(doc.user.toString());
    }
    expect(notices.some((call) => call[0] === holder.id)).toBe(false);
    // The API lists each affected traveller once, however many bookings they had.
    expect(new Set(notices.map((call) => call[0]))).toEqual(
      new Set([ana.id, omar.id, sara.id]),
    );
  });

  it('can be repeated without a second refund or a second notice', async () => {
    const flight = await makeFlight();
    const mod = await loggedInAs(Role.AIRLINE_MODERATOR, airline.id);
    const traveller = await loggedInAs();
    await confirmed(traveller, flight, [adult('Rana Adel', 'E5000001')]);
    const url = `/api/flights/${flight.id}/cancel`;

    const first = await mod.client
      .post(url)
      .send({ confirm: true })
      .expect(201);
    expect((first.body as CancelBody).notifiedPassengers).toBe(1);
    expect(refundService.issue).toHaveBeenCalledTimes(1);
    expect(cancelNotices()).toHaveLength(1);

    const again = await mod.client
      .post(url)
      .send({ confirm: true })
      .expect(201);
    expect(again.body).toMatchObject({
      cancelledBookings: 0,
      notifiedPassengers: 0,
    });
    expect(refundService.issue).toHaveBeenCalledTimes(1);
    expect(cancelNotices()).toHaveLength(1);
  });

  it('is the booking module itself that answers: the hook is registered and no seat can be held afterwards', async () => {
    const flight = await makeFlight();
    const mod = await loggedInAs(Role.AIRLINE_MODERATOR, airline.id);
    expect(ctx.moduleRef.get(FlightBookingHooks).get()).toBeDefined();

    await mod.client
      .post(`/api/flights/${flight.id}/cancel`)
      .send({ confirm: true })
      .expect(201);

    const late = await loggedInAs();
    await late.client
      .post('/api/flight-bookings/hold')
      .send({
        outbound: { flightId: flight.id, cabinClass: 'Economy' },
        passengers: [adult('Late Comer', 'F6000001')],
      })
      .expect((response) => {
        expect(response.status).toBeGreaterThanOrEqual(400);
      });
    expect(await cabinCounters(flight)).toEqual({ booked: 0, held: 0 });
  });
});
