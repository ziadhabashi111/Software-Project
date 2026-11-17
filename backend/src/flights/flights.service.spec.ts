import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import type { AirlinesService } from './airlines.service';
import type { AirportsService } from './airports.service';
import { CabinClass, FlightStatus } from './flight-status';
import { FlightBookingHooks } from './flight-booking-hooks';
import { FlightsService } from './flights.service';
import type { Flight } from './schemas/flight.schema';

/** Arguments of one recorded call to a jest mock. */
const argsOf = (mock: jest.Mock, call = 0): unknown[] =>
  mock.mock.calls[call] as unknown[];

const AIRLINE_ID = new Types.ObjectId().toString();
const moderator: AuthUser = {
  id: 'm1',
  role: Role.AIRLINE_MODERATOR,
  providerId: AIRLINE_ID,
};
const otherModerator: AuthUser = {
  id: 'm2',
  role: Role.AIRLINE_MODERATOR,
  providerId: new Types.ObjectId().toString(),
};

const airports = [
  {
    iataCode: 'CAI',
    name: 'Cairo International Airport',
    cityId: 'cairo',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
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
];

function cabin(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    cabinClass: CabinClass.ECONOMY,
    totalSeats: 100,
    bookedSeats: 0,
    heldSeats: 0,
    price: 400,
    freeBags: 1,
    maxBagWeightKg: 23,
    ...overrides,
  };
}

function flight(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    id: 'f1',
    airlineId: new Types.ObjectId(AIRLINE_ID),
    flightNumber: 'MS985',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureUtc: new Date('2090-03-01T12:30:00Z'),
    arrivalUtc: new Date('2090-03-02T00:45:00Z'),
    departureLocalDate: '2090-03-01',
    status: FlightStatus.SCHEDULED,
    everBooked: false,
    cabins: [cabin()],
    ...overrides,
  };
}

function build(found: ReturnType<typeof flight> | null) {
  const model = {
    findById: jest.fn().mockResolvedValue(found),
    create: jest
      .fn()
      .mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({ ...flight(), ...doc, cabins: [] }),
      ),
    findOneAndUpdate: jest.fn().mockResolvedValue(found),
    updateMany: jest.fn().mockResolvedValue({}),
  };
  const airportsService = {
    findByCodes: jest.fn((codes: string[]) =>
      Promise.resolve(airports.filter((a) => codes.includes(a.iataCode))),
    ),
  };
  const airlinesService = {
    findForFlights: jest
      .fn()
      .mockResolvedValue({ id: AIRLINE_ID, name: 'EgyptAir', code: 'MS' }),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const hooks = new FlightBookingHooks();
  const service = new FlightsService(
    model as unknown as Model<Flight>,
    airportsService as unknown as AirportsService,
    airlinesService as unknown as AirlinesService,
    hooks,
    notifications,
  );
  return { service, model, hooks, notifications };
}

const createDto = {
  flightNumber: 'MS985',
  departureAirport: 'CAI',
  arrivalAirport: 'JFK',
  departureTime: '2090-03-01T14:30',
  arrivalTime: '2090-03-01T19:45',
};

describe('FlightsService.create (FLT-03)', () => {
  it('stores local times as UTC and returns them back in local time', async () => {
    const { service, model } = build(null);
    const view = await service.create(moderator, createDto);

    const stored = argsOf(model.create, 0)[0] as Record<string, unknown>;
    expect((stored.departureUtc as Date).toISOString()).toBe(
      '2090-03-01T12:30:00.000Z',
    );
    expect((stored.arrivalUtc as Date).toISOString()).toBe(
      '2090-03-02T00:45:00.000Z',
    );
    expect(stored.departureLocalDate).toBe('2090-03-01');
    expect(String(stored.airlineId)).toBe(AIRLINE_ID);

    expect(view.departure).toMatchObject({
      localTime: '14:30',
      utcOffset: '+02:00',
    });
    expect(view.arrival).toMatchObject({
      localTime: '19:45',
      utcOffset: '-05:00',
    });
    expect(view.durationMinutes).toBe(735);
    expect(view.status).toBe(FlightStatus.SCHEDULED);
  });

  it.each([
    ['identical airports', { arrivalAirport: 'CAI' }],
    ['an airport outside the list', { arrivalAirport: 'ZZZ' }],
    [
      'a departure in the past',
      { departureTime: '2020-03-01T14:30', arrivalTime: '2020-03-01T20:00' },
    ],
    ['an arrival before the departure', { arrivalTime: '2090-03-01T05:00' }],
  ])('rejects %s without saving', async (_name, change) => {
    const { service, model } = build(null);
    await expect(
      service.create(moderator, { ...createDto, ...change }),
    ).rejects.toMatchObject({ status: 400 });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('answers 409 for a duplicate flight number on the same date', async () => {
    const { service, model } = build(null);
    model.create.mockRejectedValueOnce(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    await expect(service.create(moderator, createDto)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('keeps users and other roles out', async () => {
    const { service } = build(null);
    await expect(
      service.create({ id: 'u1', role: Role.USER }, createDto),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('FlightsService.update (FLT-05, FLT-30)', () => {
  it('blocks another airline’s moderator', async () => {
    const { service } = build(flight());
    await expect(
      service.update('f1', otherModerator, {
        departureTime: '2090-03-01T15:00',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('only edits Scheduled flights: Cancelled and Departed are refused', async () => {
    for (const status of [FlightStatus.CANCELLED, FlightStatus.DEPARTED]) {
      const { service, model } = build(flight({ status }));
      await expect(
        service.update('f1', moderator, { departureTime: '2090-03-01T15:00' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    }
  });

  it('treats a Scheduled flight whose time has passed as Departed', async () => {
    const { service } = build(
      flight({
        departureUtc: new Date('2020-01-01T10:00:00Z'),
        arrivalUtc: new Date('2020-01-01T12:00:00Z'),
      }),
    );
    await expect(
      service.update('f1', moderator, { arrivalTime: '2020-01-01T15:00' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('locks the airports once the flight has any booking, even a cancelled one', async () => {
    for (const booked of [
      flight({ everBooked: true }),
      flight({ cabins: [cabin({ heldSeats: 1 })] }),
    ]) {
      const { service, model } = build(booked);
      await expect(
        service.update('f1', moderator, { arrivalAirport: 'LHR' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    }
  });

  it('changes airports on an unbooked flight, guarded against a hold that arrives meanwhile', async () => {
    const { service, model } = build(flight());
    await service.update('f1', moderator, { arrivalAirport: 'LHR' });
    const filter = argsOf(model.findOneAndUpdate, 0)[0] as Record<
      string,
      unknown
    >;
    expect(filter.everBooked).toBe(false);
    expect(filter.cabins).toBeDefined();
  });

  it('notifies Confirmed passengers when a time changes', async () => {
    const { service, hooks, notifications } = build(flight());
    hooks.register({
      getConfirmedPassengerUserIds: jest.fn().mockResolvedValue(['u1', 'u2']),
    });
    await service.update('f1', moderator, {
      departureTime: '2090-03-01T15:00',
    });
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(
      'u1',
      'FLIGHT_TIME_CHANGED',
      expect.stringContaining('MS985'),
    );
  });

  it('does not notify when nothing about the times changed', async () => {
    const { service, hooks, notifications } = build(flight());
    hooks.register({
      getConfirmedPassengerUserIds: jest.fn().mockResolvedValue(['u1']),
    });
    await service.update('f1', moderator, {
      departureTime: '2090-03-01T14:30',
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('rejects an empty change', async () => {
    const { service } = build(flight());
    await expect(service.update('f1', moderator, {})).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('cabins (FLT-04, FLT-05)', () => {
  const dto = {
    cabinClass: CabinClass.BUSINESS,
    seats: 20,
    price: 1200,
    freeBags: 2,
    maxBagWeightKg: 32,
  };

  it('adds each cabin class once per flight', async () => {
    const { service, model } = build(flight());
    model.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(
      service.addCabin('f1', moderator, {
        ...dto,
        cabinClass: CabinClass.ECONOMY,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('guards the add with the "class not already present" condition', async () => {
    const { service, model } = build(flight());
    await service.addCabin('f1', moderator, dto);
    const filter = argsOf(model.findOneAndUpdate, 0)[0] as Record<
      string,
      unknown
    >;
    expect(filter['cabins.cabinClass']).toEqual({ $ne: CabinClass.BUSINESS });
  });

  it('refuses a seat count below booked + held, checked atomically', async () => {
    const economy = cabin({ bookedSeats: 40, heldSeats: 10 });
    const { service, model } = build(flight({ cabins: [economy] }));
    model.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(
      service.updateCabin('f1', economy._id.toString(), moderator, {
        seats: 49,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        error: 'Conflict',
        message: expect.stringContaining('below') as string,
        code: 'SEATS_BELOW_BOOKED',
      },
    });
    const filter = argsOf(model.findOneAndUpdate, 0)[0] as Record<
      string,
      unknown
    >;
    expect(filter.$expr).toBeDefined();
  });

  it('changes the price without touching seats or bookings', async () => {
    const economy = cabin({ bookedSeats: 40 });
    const { service, model } = build(flight({ cabins: [economy] }));
    await service.updateCabin('f1', economy._id.toString(), moderator, {
      price: 450,
    });
    const update = argsOf(model.findOneAndUpdate, 0)[1] as {
      $set: Record<string, number>;
    };
    expect(update.$set).toEqual({ 'cabins.$[c].price': 450 });
  });

  it('answers 404 for a cabin that is not on the flight', async () => {
    const { service } = build(flight());
    await expect(
      service.updateCabin('f1', new Types.ObjectId().toString(), moderator, {
        price: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('FlightsService.markDeparted (FLT-30)', () => {
  it('moves due Scheduled flights to Departed', async () => {
    const { service, model } = build(null);
    await service.markDeparted();
    const [filter, update] = model.updateMany.mock.calls[0] as [
      { status: FlightStatus },
      { $set: { status: FlightStatus } },
    ];
    expect(filter.status).toBe(FlightStatus.SCHEDULED);
    expect(update.$set.status).toBe(FlightStatus.DEPARTED);
  });
});
