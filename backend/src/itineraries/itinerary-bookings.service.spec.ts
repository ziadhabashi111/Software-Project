import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { BookingStatus } from '../common/booking-status/booking-status';
import type { MyFlightBookingsService } from '../flight-bookings/my-flight-bookings.service';
import type { MyHotelReservationsService } from '../hotel-bookings/my-hotel-reservations.service';
import { LinkedBookingType } from './booking-links';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import type { ItineraryRepository } from './itinerary.repository';
import type { ItineraryBooking } from './schemas/itinerary-booking.schema';

const USER: AuthUser = { id: new Types.ObjectId().toString(), role: Role.USER };
const ITINERARY_ID = new Types.ObjectId().toString();
const DAY_1 = new Types.ObjectId();
const DAY_2 = new Types.ObjectId();
const FLIGHT_BOOKING = new Types.ObjectId().toString();
const HOTEL_BOOKING = new Types.ObjectId().toString();

const itinerary = {
  id: ITINERARY_ID,
  _id: new Types.ObjectId(ITINERARY_ID),
  owner: new Types.ObjectId(USER.id),
  days: [
    { _id: DAY_1, city: 'cairo' },
    { _id: DAY_2, city: 'luxor' },
  ],
};

function flightView(status = BookingStatus.CONFIRMED) {
  return {
    reference: 'FB-ABC123',
    status,
    segments: [
      {
        flightNumber: 'EG123',
        departure: { airport: { iataCode: 'CAI' }, localDate: '2027-03-10' },
        arrival: { airport: { iataCode: 'JFK' }, localDate: '2027-03-10' },
      },
    ],
    price: { total: 840 },
    currency: 'USD',
  };
}

function hotelView(status = BookingStatus.CONFIRMED) {
  return {
    reference: 'HB-XYZ789',
    status,
    hotel: { id: 'h1', name: 'Nile View Hotel' },
    checkIn: '2027-03-10',
    checkOut: '2027-03-13',
    totalPrice: 450,
    currency: 'USD',
  };
}

/** A stored link, as the database returns it. */
function linkDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: new Types.ObjectId().toString(),
    itineraryId: itinerary._id,
    dayId: DAY_1,
    bookingType: LinkedBookingType.FLIGHT,
    bookingId: new Types.ObjectId(FLIGHT_BOOKING),
    createdAt: new Date('2026-12-01T00:00:00Z'),
    ...overrides,
  };
}

/** A thenable query so `await model.find(...).sort(...)` resolves to `rows`. */
function query<T>(rows: T) {
  const q: Record<string, unknown> = {};
  q.sort = () => q;
  (q as { then: unknown }).then = (resolve: (value: T) => unknown) =>
    resolve(rows);
  return q;
}

function build(options: { stored?: ReturnType<typeof linkDoc>[] } = {}) {
  const links = {
    create: jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve(linkDoc(data)),
      ),
    find: jest.fn().mockReturnValue(query(options.stored ?? [])),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const itineraries = { loadOwned: jest.fn().mockResolvedValue(itinerary) };
  const flights = { get: jest.fn().mockResolvedValue(flightView()) };
  const hotels = { get: jest.fn().mockResolvedValue(hotelView()) };
  const service = new ItineraryBookingsService(
    links as unknown as Model<ItineraryBooking>,
    itineraries as unknown as ItineraryRepository,
    flights as unknown as MyFlightBookingsService,
    hotels as unknown as MyHotelReservationsService,
  );
  return { service, links, itineraries, flights, hotels };
}

describe('ItineraryBookingsService.link (ITN-27)', () => {
  it('links the user’s own confirmed flight to a day and shows it', async () => {
    const { service, links, flights } = build();
    const view = await service.link(USER, ITINERARY_ID, {
      bookingType: LinkedBookingType.FLIGHT,
      bookingId: FLIGHT_BOOKING,
      dayId: DAY_1.toString(),
    });

    // The booking is read as its owner, so another user's booking is a 404.
    expect(flights.get).toHaveBeenCalledWith(FLIGHT_BOOKING, {
      id: USER.id,
      role: Role.USER,
    });
    expect(links.create).toHaveBeenCalledWith({
      itineraryId: itinerary._id,
      dayId: DAY_1,
      bookingType: LinkedBookingType.FLIGHT,
      bookingId: new Types.ObjectId(FLIGHT_BOOKING),
    });
    expect(view).toMatchObject({
      bookingType: LinkedBookingType.FLIGHT,
      dayId: DAY_1.toString(),
      dayNumber: 1,
      reference: 'FB-ABC123',
      title: 'CAI → JFK · EG123',
      amount: 840,
      currency: 'USD',
      counted: true,
    });
  });

  it('links a confirmed hotel reservation to a day', async () => {
    const { service, hotels } = build();
    const view = await service.link(USER, ITINERARY_ID, {
      bookingType: LinkedBookingType.HOTEL,
      bookingId: HOTEL_BOOKING,
      dayId: DAY_2.toString(),
    });
    expect(hotels.get).toHaveBeenCalledWith(
      { id: USER.id, role: Role.USER },
      HOTEL_BOOKING,
    );
    expect(view).toMatchObject({
      bookingType: LinkedBookingType.HOTEL,
      dayNumber: 2,
      title: 'Nile View Hotel',
      amount: 450,
    });
  });

  // 404 for someone else's itinerary, before any booking is looked at.
  it('does not touch the bookings when the itinerary is not the user’s', async () => {
    const { service, itineraries, flights, links } = build();
    itineraries.loadOwned.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.link(USER, ITINERARY_ID, {
        bookingType: LinkedBookingType.FLIGHT,
        bookingId: FLIGHT_BOOKING,
        dayId: DAY_1.toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(flights.get).not.toHaveBeenCalled();
    expect(links.create).not.toHaveBeenCalled();
  });

  it('rejects a day that is not in the itinerary', async () => {
    const { service, links, flights } = build();
    const error = await service
      .link(USER, ITINERARY_ID, {
        bookingType: LinkedBookingType.FLIGHT,
        bookingId: FLIGHT_BOOKING,
        dayId: new Types.ObjectId().toString(),
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).toContain('dayId');
    expect(flights.get).not.toHaveBeenCalled();
    expect(links.create).not.toHaveBeenCalled();
  });

  // Someone else's booking, or none at all, is the booking module's own 404.
  it('passes on the 404 for a booking that is not the user’s', async () => {
    const { service, flights, links } = build();
    flights.get.mockRejectedValueOnce(
      new NotFoundException('Booking not found'),
    );
    await expect(
      service.link(USER, ITINERARY_ID, {
        bookingType: LinkedBookingType.FLIGHT,
        bookingId: FLIGHT_BOOKING,
        dayId: DAY_1.toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(links.create).not.toHaveBeenCalled();
  });

  it.each([
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.EXPIRED,
    BookingStatus.CANCELLED,
  ])('refuses a %s booking with 409', async (status) => {
    const { service, hotels, links } = build();
    hotels.get.mockResolvedValueOnce(hotelView(status));
    const error = await service
      .link(USER, ITINERARY_ID, {
        bookingType: LinkedBookingType.HOTEL,
        bookingId: HOTEL_BOOKING,
        dayId: DAY_1.toString(),
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(links.create).not.toHaveBeenCalled();
  });

  // Counting one booking twice would double its cost in the budget.
  it('answers 409 when the booking is already linked to this itinerary', async () => {
    const { service, links } = build();
    links.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: 11000 }),
    );
    await expect(
      service.link(USER, ITINERARY_ID, {
        bookingType: LinkedBookingType.FLIGHT,
        bookingId: FLIGHT_BOOKING,
        dayId: DAY_1.toString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ItineraryBookingsService.list (ITN-27)', () => {
  it('shows each link with the booking’s current details, by day', async () => {
    const stored = [
      linkDoc({
        dayId: DAY_2,
        bookingType: LinkedBookingType.HOTEL,
        bookingId: new Types.ObjectId(HOTEL_BOOKING),
      }),
      linkDoc({ dayId: DAY_1 }),
    ];
    const { service } = build({ stored });
    const views = await service.list(USER, ITINERARY_ID);
    expect(views.map((v) => [v.dayNumber, v.bookingType])).toEqual([
      [1, LinkedBookingType.FLIGHT],
      [2, LinkedBookingType.HOTEL],
    ]);
  });

  // The traveller must see that a linked booking was cancelled, and that it
  // no longer counts, instead of it silently vanishing.
  it('keeps a cancelled booking in the list but marks it as not counted', async () => {
    const { service, flights } = build({ stored: [linkDoc()] });
    flights.get.mockResolvedValueOnce(flightView(BookingStatus.CANCELLED));
    const [view] = await service.list(USER, ITINERARY_ID);
    expect(view).toMatchObject({
      status: BookingStatus.CANCELLED,
      counted: false,
    });
  });

  it('leaves out a link whose booking can no longer be found', async () => {
    const { service, flights } = build({ stored: [linkDoc()] });
    flights.get.mockRejectedValueOnce(new NotFoundException());
    expect(await service.list(USER, ITINERARY_ID)).toEqual([]);
  });

  it('is empty, and asks the bookings nothing, when nothing is linked', async () => {
    const { service, flights, hotels } = build();
    expect(await service.list(USER, ITINERARY_ID)).toEqual([]);
    expect(flights.get).not.toHaveBeenCalled();
    expect(hotels.get).not.toHaveBeenCalled();
  });
});

describe('ItineraryBookingsService.unlink (ITN-27)', () => {
  const LINK_ID = new Types.ObjectId().toString();

  it('removes the link, never the booking itself', async () => {
    const { service, links } = build();
    await service.unlink(USER, ITINERARY_ID, LINK_ID);
    expect(links.deleteOne).toHaveBeenCalledWith({
      _id: LINK_ID,
      itineraryId: itinerary._id,
    });
  });

  it('answers 404 for a link that is not on this itinerary', async () => {
    const { service, links } = build();
    links.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
    await expect(
      service.unlink(USER, ITINERARY_ID, LINK_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ItineraryBookingsService.budgetLines (ITN-27)', () => {
  it('turns live linked bookings into budget lines on their days', async () => {
    const stored = [
      linkDoc(),
      linkDoc({
        dayId: DAY_2,
        bookingType: LinkedBookingType.HOTEL,
        bookingId: new Types.ObjectId(HOTEL_BOOKING),
      }),
    ];
    const { service } = build({ stored });
    const lines = await service.budgetLines(itinerary as never);
    expect(lines.transportCosts).toEqual([
      { dayId: DAY_1.toString(), amount: 840, currency: 'USD' },
    ]);
    expect(lines.entries).toEqual([
      expect.objectContaining({
        dayId: DAY_2.toString(),
        category: 'accommodation',
        amount: 450,
      }),
    ]);
  });

  it('adds nothing for a cancelled booking or one that cannot be found', async () => {
    const { service, flights, hotels } = build({
      stored: [
        linkDoc(),
        linkDoc({
          bookingType: LinkedBookingType.HOTEL,
          bookingId: new Types.ObjectId(HOTEL_BOOKING),
        }),
      ],
    });
    flights.get.mockResolvedValueOnce(flightView(BookingStatus.CANCELLED));
    hotels.get.mockRejectedValueOnce(new NotFoundException());
    expect(await service.budgetLines(itinerary as never)).toEqual({
      entries: [],
      transportCosts: [],
    });
  });

  it('adds nothing, and asks nothing, when nothing is linked', async () => {
    const { service, flights } = build();
    expect(await service.budgetLines(itinerary as never)).toEqual({
      entries: [],
      transportCosts: [],
    });
    expect(flights.get).not.toHaveBeenCalled();
  });
});
