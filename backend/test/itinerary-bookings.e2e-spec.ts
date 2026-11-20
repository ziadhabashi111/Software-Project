import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import type { AuthUser } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { BookingStatus } from '../src/common/booking-status/booking-status';
import type { FlightBookingView } from '../src/flight-bookings/flight-booking-view';
import { MyFlightBookingsService } from '../src/flight-bookings/my-flight-bookings.service';
import { HotelReservationPayments } from '../src/hotel-bookings/hotel-reservation-payments';
import { formatDate } from '../src/hotel-bookings/stay-rules';
import { HotelsModule } from '../src/hotels/hotels.module';
import {
  ItineraryBooking,
  ItineraryBookingDocument,
} from '../src/itineraries/schemas/itinerary-booking.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const NIGHT_PRICE = 100;

type Agent = ReturnType<typeof request.agent>;

interface ItineraryBody {
  id: string;
  days: { id: string }[];
}

interface LinkBody {
  id: string;
  bookingType: string;
  bookingId: string;
  dayId: string;
  dayNumber: number;
  reference: string | null;
  title: string;
  status: string;
  amount: number;
  currency: string;
  counted: boolean;
}

interface SummaryBody {
  totals: {
    accommodation: number;
    intercity_transport: number;
    total: number;
  };
  byDay: { total: number }[];
}

/** A calendar date `offset` days from today, so the tests never go stale. */
const day = (offset: number): string =>
  formatDate(new Date(Date.now() + offset * 86_400_000));

describe('Linking bookings to itinerary days (ITN-27; real MongoDB replica set in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let linkModel: Model<ItineraryBookingDocument>;
  let counter = 0;
  let place = 0;
  /** Flight bookings the stubbed lookup knows: booking id -> owner and status. */
  const flightBookings = new Map<
    string,
    { ownerId: string; status: BookingStatus }
  >();
  let flightSeq = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      replSet: true,
      extraModules: [AuditModule, AdminModule, HotelsModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    linkModel = ctx.moduleRef.get<Model<ItineraryBookingDocument>>(
      getModelToken(ItineraryBooking.name),
    );
    // Flight inventory is heavy to set up and its own view is covered by the
    // flight booking suites, so only its lookup is stubbed (on the real
    // instance, which also proves the module exports it).
    jest
      .spyOn(ctx.moduleRef.get(MyFlightBookingsService), 'get')
      .mockImplementation((id: string, user: AuthUser) => {
        const booking = flightBookings.get(id);
        if (!booking || booking.ownerId !== user.id) {
          return Promise.reject(new NotFoundException('Booking not found'));
        }
        return Promise.resolve({
          reference: `FB-${id.slice(-6).toUpperCase()}`,
          status: booking.status,
          segments: [
            {
              flightNumber: 'EG123',
              departure: {
                airport: { iataCode: 'CAI' },
                localDate: day(10),
              },
              arrival: { airport: { iataCode: 'JFK' }, localDate: day(10) },
            },
          ],
          price: { total: 840 },
          currency: 'USD',
        } as unknown as FlightBookingView);
      });
  }, 180_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx.close();
  });

  async function loggedInAs(
    role: Role = Role.USER,
    providerId?: string,
  ): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `link${counter}@example.com`;
    const doc = await users.create({
      name: `Link Person ${counter}`,
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

  /** A hotel with one room open from day 5 to day 60, and the traveller's stay in it. */
  async function confirmedStay(
    traveller: { id: string; client: Agent },
    nights = 3,
  ): Promise<{ reservationId: string; hotelName: string; total: number }> {
    place += 1;
    const admin = await loggedInAs(Role.ADMIN);
    const hotelName = `Linked Hotel ${place}`;
    const hotel = (
      await admin.client
        .post('/api/hotels')
        .send({
          name: hotelName,
          address: '1 Test Road',
          city: `link-town-${place}`,
          country: `L${String.fromCharCode(64 + place)}`,
          starClass: 3,
        })
        .expect(201)
    ).body as { id: string };
    const moderator = await loggedInAs(Role.HOTEL_MODERATOR, hotel.id);
    const room = (
      await moderator.client
        .post(`/api/hotels/${hotel.id}/rooms`)
        .send({
          name: '1',
          beds: 2,
          maxOccupancy: 2,
          pricePerNight: NIGHT_PRICE,
        })
        .expect(201)
    ).body as { id: string };
    await moderator.client
      .post(`/api/hotels/${hotel.id}/rooms/${room.id}/availability`)
      .send({ from: day(5), to: day(60) })
      .expect(201);
    const held = (
      await traveller.client
        .post('/api/hotel-bookings')
        .send({
          hotelId: hotel.id,
          checkIn: day(10),
          checkOut: day(10 + nights),
          rooms: [{ roomId: room.id, adults: 2, childrenAges: [] }],
        })
        .expect(201)
    ).body as { id: string; totalPrice: number };
    return {
      reservationId: held.id,
      hotelName,
      total: held.totalPrice,
    };
  }

  /** Pays the held reservation, as the Stripe webhook would. */
  async function confirm(reservationId: string, total: number): Promise<void> {
    await ctx.moduleRef
      .get(HotelReservationPayments)
      .confirmPaid(reservationId, {
        paymentIntentId: `pi_${reservationId}`,
        amount: total,
        currency: 'USD',
      });
  }

  function newFlightBooking(ownerId: string, status = BookingStatus.CONFIRMED) {
    flightSeq += 1;
    const id = `66${flightSeq.toString(16).padStart(22, '0')}`;
    flightBookings.set(id, { ownerId, status });
    return id;
  }

  /** An itinerary with two days. */
  async function itineraryOf(client: Agent): Promise<ItineraryBody> {
    const created = (
      await client
        .post('/api/itineraries')
        .send({ title: 'Plan', countries: ['EG'], startDate: day(10) })
        .expect(201)
    ).body as { id: string };
    for (const city of ['cairo', 'luxor']) {
      await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city })
        .expect(201);
    }
    return (await client.get(`/api/itineraries/${created.id}`).expect(200))
      .body as ItineraryBody;
  }

  const link = (
    client: Agent,
    itineraryId: string,
    body: Record<string, unknown>,
  ) => client.post(`/api/itineraries/${itineraryId}/bookings`).send(body);

  const summary = async (client: Agent, itineraryId: string) =>
    (
      await client
        .get(`/api/itineraries/${itineraryId}/budget-summary?currency=USD`)
        .expect(200)
    ).body as SummaryBody;

  describe('a hotel reservation', () => {
    it('links to a day, is listed, and feeds accommodation in the budget', async () => {
      const traveller = await loggedInAs();
      const stay = await confirmedStay(traveller);
      await confirm(stay.reservationId, stay.total);
      const itinerary = await itineraryOf(traveller.client);

      const res = await link(traveller.client, itinerary.id, {
        bookingType: 'hotel',
        bookingId: stay.reservationId,
        dayId: itinerary.days[1].id,
      }).expect(201);
      const linked = res.body as LinkBody;
      expect(linked).toMatchObject({
        bookingType: 'hotel',
        dayNumber: 2,
        title: stay.hotelName,
        status: 'CONFIRMED',
        amount: stay.total,
        currency: 'USD',
        counted: true,
      });
      expect(linked.reference).toEqual(expect.any(String));

      const list = (
        await traveller.client
          .get(`/api/itineraries/${itinerary.id}/bookings`)
          .expect(200)
      ).body as LinkBody[];
      expect(list.map((l) => l.id)).toEqual([linked.id]);

      const budget = await summary(traveller.client, itinerary.id);
      expect(budget.totals.accommodation).toBe(stay.total);
      expect(budget.byDay[1].total).toBe(stay.total);
    });

    it('is refused while it is only a hold (pending payment)', async () => {
      const traveller = await loggedInAs();
      const stay = await confirmedStay(traveller);
      const itinerary = await itineraryOf(traveller.client);
      await link(traveller.client, itinerary.id, {
        bookingType: 'hotel',
        bookingId: stay.reservationId,
        dayId: itinerary.days[0].id,
      }).expect(409);
    });

    it('cannot be linked twice to the same itinerary, so it is never counted twice', async () => {
      const traveller = await loggedInAs();
      const stay = await confirmedStay(traveller);
      await confirm(stay.reservationId, stay.total);
      const itinerary = await itineraryOf(traveller.client);
      const body = {
        bookingType: 'hotel',
        bookingId: stay.reservationId,
        dayId: itinerary.days[0].id,
      };
      await link(traveller.client, itinerary.id, body).expect(201);
      await link(traveller.client, itinerary.id, body).expect(409);
      expect(
        (await summary(traveller.client, itinerary.id)).totals.accommodation,
      ).toBe(stay.total);
    });

    // A cancelled stay must stop counting at once, but stay visible.
    it('stops counting once the reservation is cancelled, and stays listed', async () => {
      const traveller = await loggedInAs();
      const stay = await confirmedStay(traveller);
      await confirm(stay.reservationId, stay.total);
      const itinerary = await itineraryOf(traveller.client);
      await link(traveller.client, itinerary.id, {
        bookingType: 'hotel',
        bookingId: stay.reservationId,
        dayId: itinerary.days[0].id,
      }).expect(201);

      await traveller.client
        .post(`/api/hotel-bookings/${stay.reservationId}/cancel`)
        .query({ confirm: 'true' })
        .expect(200);

      const [row] = (
        await traveller.client
          .get(`/api/itineraries/${itinerary.id}/bookings`)
          .expect(200)
      ).body as LinkBody[];
      expect(row).toMatchObject({ status: 'CANCELLED', counted: false });
      expect(
        (await summary(traveller.client, itinerary.id)).totals.accommodation,
      ).toBe(0);
    });
  });

  describe('a flight booking', () => {
    it('links to a day and feeds intercity transport', async () => {
      const traveller = await loggedInAs();
      const bookingId = newFlightBooking(traveller.id);
      const itinerary = await itineraryOf(traveller.client);

      const res = await link(traveller.client, itinerary.id, {
        bookingType: 'flight',
        bookingId,
        dayId: itinerary.days[0].id,
      }).expect(201);
      expect(res.body).toMatchObject({
        bookingType: 'flight',
        title: 'CAI → JFK · EG123',
        amount: 840,
        counted: true,
      });
      const budget = await summary(traveller.client, itinerary.id);
      expect(budget.totals.intercity_transport).toBe(840);
    });

    it('stops counting when the booking is cancelled', async () => {
      const traveller = await loggedInAs();
      const bookingId = newFlightBooking(traveller.id);
      const itinerary = await itineraryOf(traveller.client);
      await link(traveller.client, itinerary.id, {
        bookingType: 'flight',
        bookingId,
        dayId: itinerary.days[0].id,
      }).expect(201);

      flightBookings.get(bookingId)!.status = BookingStatus.CANCELLED;
      const budget = await summary(traveller.client, itinerary.id);
      expect(budget.totals.intercity_transport).toBe(0);
    });
  });

  describe('who may link what', () => {
    it('answers 404 for someone else’s booking, and 404 for someone else’s itinerary', async () => {
      const alice = await loggedInAs();
      const bob = await loggedInAs();
      const bobsFlight = newFlightBooking(bob.id);
      const aliceItinerary = await itineraryOf(alice.client);
      const bobItinerary = await itineraryOf(bob.client);

      // Alice cannot link Bob's booking to her own itinerary...
      await link(alice.client, aliceItinerary.id, {
        bookingType: 'flight',
        bookingId: bobsFlight,
        dayId: aliceItinerary.days[0].id,
      }).expect(404);
      // ...nor link her own booking to Bob's itinerary.
      const alicesFlight = newFlightBooking(alice.id);
      await link(alice.client, bobItinerary.id, {
        bookingType: 'flight',
        bookingId: alicesFlight,
        dayId: bobItinerary.days[0].id,
      }).expect(404);
      await alice.client
        .get(`/api/itineraries/${bobItinerary.id}/bookings`)
        .expect(404);
    });

    it('needs a login and a regular user', async () => {
      const traveller = await loggedInAs();
      const itinerary = await itineraryOf(traveller.client);
      const body = {
        bookingType: 'flight',
        bookingId: newFlightBooking(traveller.id),
        dayId: itinerary.days[0].id,
      };
      await link(guest(), itinerary.id, body).expect(401);
      const admin = await loggedInAs(Role.ADMIN);
      await link(admin.client, itinerary.id, body).expect(403);
    });

    it('validates the request', async () => {
      const traveller = await loggedInAs();
      const itinerary = await itineraryOf(traveller.client);
      const bookingId = newFlightBooking(traveller.id);
      const good = {
        bookingType: 'flight',
        bookingId,
        dayId: itinerary.days[0].id,
      };
      await link(traveller.client, itinerary.id, {
        ...good,
        bookingType: 'train',
      }).expect(400);
      await link(traveller.client, itinerary.id, {
        ...good,
        bookingId: 'nope',
      }).expect(400);
      await link(traveller.client, itinerary.id, {
        ...good,
        dayId: '665f1c2a9b1e8a0012345670', // a valid id, but not a day of this itinerary
      }).expect(400);
      await link(traveller.client, itinerary.id, { ...good, extra: 1 }).expect(
        400,
      );
      await traveller.client
        .post('/api/itineraries/not-an-id/bookings')
        .send(good)
        .expect(404);
    });
  });

  describe('unlinking and cleanup', () => {
    async function linked() {
      const traveller = await loggedInAs();
      const itinerary = await itineraryOf(traveller.client);
      const res = await link(traveller.client, itinerary.id, {
        bookingType: 'flight',
        bookingId: newFlightBooking(traveller.id),
        dayId: itinerary.days[0].id,
      }).expect(201);
      return { traveller, itinerary, linkId: (res.body as LinkBody).id };
    }

    it('unlinks, and the budget goes back', async () => {
      const { traveller, itinerary, linkId } = await linked();
      await traveller.client
        .delete(`/api/itineraries/${itinerary.id}/bookings/${linkId}`)
        .expect(204);
      expect(
        (await summary(traveller.client, itinerary.id)).totals
          .intercity_transport,
      ).toBe(0);
      await traveller.client
        .delete(`/api/itineraries/${itinerary.id}/bookings/${linkId}`)
        .expect(404);
    });

    it('does not let another user unlink', async () => {
      const { itinerary, linkId } = await linked();
      const other = await loggedInAs();
      await other.client
        .delete(`/api/itineraries/${itinerary.id}/bookings/${linkId}`)
        .expect(404);
    });

    it('removes the links of a deleted day', async () => {
      const { traveller, itinerary } = await linked();
      await traveller.client
        .delete(`/api/itineraries/${itinerary.id}/days/${itinerary.days[0].id}`)
        .query({ confirm: 'true' })
        .expect(200);
      expect(
        await linkModel.countDocuments({ itineraryId: itinerary.id }),
      ).toBe(0);
    });

    it('removes the links of a deleted itinerary', async () => {
      const { traveller, itinerary } = await linked();
      await traveller.client
        .delete(`/api/itineraries/${itinerary.id}`)
        .query({ confirm: 'true' });
      expect(
        await linkModel.countDocuments({ itineraryId: itinerary.id }),
      ).toBe(0);
    });
  });

  // Bookings hold references and prices, which are private.
  describe('public itineraries', () => {
    it('never show linked bookings, in the itinerary, its budget or a clone', async () => {
      const owner = await loggedInAs();
      const stay = await confirmedStay(owner);
      await confirm(stay.reservationId, stay.total);
      const itinerary = await itineraryOf(owner.client);
      const flightId = newFlightBooking(owner.id);
      await link(owner.client, itinerary.id, {
        bookingType: 'hotel',
        bookingId: stay.reservationId,
        dayId: itinerary.days[0].id,
      }).expect(201);
      await link(owner.client, itinerary.id, {
        bookingType: 'flight',
        bookingId: flightId,
        dayId: itinerary.days[0].id,
      }).expect(201);
      // The owner's own budget counts both.
      const own = await summary(owner.client, itinerary.id);
      expect(own.totals.accommodation).toBe(stay.total);
      expect(own.totals.intercity_transport).toBe(840);

      await owner.client
        .patch(`/api/itineraries/${itinerary.id}`)
        .send({ visibility: 'public' })
        .expect(200);

      const publicView = await guest()
        .get(`/api/itineraries/public/${itinerary.id}?currency=USD`)
        .expect(200);
      const text = JSON.stringify(publicView.body);
      expect(text).not.toContain(stay.hotelName);
      expect(text).not.toContain('FB-');
      const budget = (publicView.body as { budget: SummaryBody }).budget;
      expect(budget.totals.accommodation).toBe(0);
      expect(budget.totals.intercity_transport).toBe(0);

      const visitor = await loggedInAs();
      const clone = (
        await visitor.client
          .post(`/api/itineraries/${itinerary.id}/clone`)
          .expect(201)
      ).body as { id: string };
      expect(
        (
          await visitor.client
            .get(`/api/itineraries/${clone.id}/bookings`)
            .expect(200)
        ).body,
      ).toEqual([]);
      expect(
        (await summary(visitor.client, clone.id)).totals.accommodation,
      ).toBe(0);
    });
  });
});
