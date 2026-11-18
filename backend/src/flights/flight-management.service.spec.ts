import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { FlightBookingHooks } from './flight-booking-hooks';
import type {
  FlightBookingLink,
  FlightBookingRow,
} from './flight-booking-hooks';
import { FlightManagementService } from './flight-management.service';
import type { FlightsService } from './flights.service';
import { CabinClass, FlightStatus } from './flight-status';
import type { Flight } from './schemas/flight.schema';

const AIRLINE_ID = new Types.ObjectId().toString();
const moderator: AuthUser = {
  id: 'm1',
  role: Role.AIRLINE_MODERATOR,
  providerId: AIRLINE_ID,
};
const stranger: AuthUser = {
  id: 'm2',
  role: Role.AIRLINE_MODERATOR,
  providerId: new Types.ObjectId().toString(),
};

function flight(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    id: 'f1',
    airlineId: new Types.ObjectId(AIRLINE_ID),
    flightNumber: 'MS985',
    departureLocalDate: '2090-03-01',
    departureUtc: new Date('2090-03-01T12:30:00Z'),
    status: FlightStatus.SCHEDULED,
    cabins: [
      {
        cabinClass: CabinClass.ECONOMY,
        totalSeats: 100,
        bookedSeats: 30,
        heldSeats: 5,
      },
    ],
    ...overrides,
  };
}

const row = (overrides: Partial<FlightBookingRow> = {}): FlightBookingRow => ({
  reference: 'FB-1',
  passengerNames: ['Ana Hassan', '=cmd|evil'],
  cabinClass: CabinClass.ECONOMY,
  seats: 2,
  status: 'Confirmed',
  ...overrides,
});

function build(found: ReturnType<typeof flight> | null, withLink = true) {
  const model = {
    findById: jest.fn().mockResolvedValue(found),
    findOneAndUpdate: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          found ? { ...found, status: FlightStatus.CANCELLED } : null,
        ),
      ),
  };
  const link = {
    getConfirmedPassengerUserIds: jest.fn().mockResolvedValue(['u1', 'u2']),
    cancelBookingsForFlight: jest
      .fn()
      .mockResolvedValue({ cancelled: 2, notifiedUserIds: ['u1', 'u2'] }),
    listBookings: jest.fn().mockResolvedValue({ items: [row()], total: 1 }),
  } satisfies FlightBookingLink;
  const hooks = new FlightBookingHooks();
  if (withLink) hooks.register(link);
  const flightsService = {
    view: jest.fn().mockResolvedValue({ id: 'f1', status: 'Cancelled' }),
  };
  const service = new FlightManagementService(
    model as unknown as Model<Flight>,
    flightsService as unknown as FlightsService,
    hooks,
  );
  return { service, model, link };
}

describe('FlightManagementService.cancel (FLT-06)', () => {
  it('cancels the flight, then has the booking module refund, notify and report who it notified', async () => {
    const { service, model, link } = build(flight());
    const result = await service.cancel('f1', moderator);

    const [filter, update] = model.findOneAndUpdate.mock.calls[0] as [
      { status: FlightStatus },
      { $set: { status: FlightStatus } },
    ];
    expect(filter.status).toBe(FlightStatus.SCHEDULED);
    expect(update.$set.status).toBe(FlightStatus.CANCELLED);
    expect(link.cancelBookingsForFlight).toHaveBeenCalledWith('f1');
    expect(result).toMatchObject({
      cancelledBookings: 2,
      notifiedPassengers: 2,
    });
  });

  it('does not read the passengers itself any more (a retry or a late booking cannot be missed)', async () => {
    const { service, link } = build(flight());
    await service.cancel('f1', moderator);
    expect(link.getConfirmedPassengerUserIds).not.toHaveBeenCalled();
  });

  it('counts the users the booking module reports, so a retry reports its own work', async () => {
    const { service, link } = build(flight({ status: FlightStatus.CANCELLED }));
    link.cancelBookingsForFlight.mockResolvedValueOnce({
      cancelled: 1,
      notifiedUserIds: ['u3'],
    });
    const result = await service.cancel('f1', moderator);
    expect(result).toMatchObject({
      cancelledBookings: 1,
      notifiedPassengers: 1,
    });
  });

  it('blocks another airline’s moderator and never touches the flight', async () => {
    const { service, model, link } = build(flight());
    await expect(service.cancel('f1', stranger)).rejects.toMatchObject({
      status: 403,
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(link.cancelBookingsForFlight).not.toHaveBeenCalled();
  });

  it('refuses a Departed flight', async () => {
    const { service, model } = build(flight({ status: FlightStatus.DEPARTED }));
    await expect(service.cancel('f1', moderator)).rejects.toMatchObject({
      status: 409,
    });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses a flight whose departure time has already passed', async () => {
    const { service } = build(
      flight({ departureUtc: new Date('2020-01-01T00:00:00Z') }),
    );
    await expect(service.cancel('f1', moderator)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('finishes the refunds when the same request is sent again for an already Cancelled flight', async () => {
    const { service, model, link } = build(
      flight({ status: FlightStatus.CANCELLED }),
    );
    const result = await service.cancel('f1', moderator);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(link.cancelBookingsForFlight).toHaveBeenCalledTimes(1);
    expect(result.cancelledBookings).toBe(2);
  });

  it('keeps the flight Cancelled and reports the failure when the cascade fails', async () => {
    const { service, model, link } = build(flight());
    link.cancelBookingsForFlight.mockRejectedValueOnce(
      new Error('refund service down'),
    );
    await expect(service.cancel('f1', moderator)).rejects.toThrow(
      'refund service down',
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('still cancels when no booking module is connected yet', async () => {
    const { service } = build(flight(), false);
    await expect(service.cancel('f1', moderator)).resolves.toMatchObject({
      cancelledBookings: 0,
      notifiedPassengers: 0,
    });
  });

  it('answers 409 when someone else changed the flight meanwhile', async () => {
    const { service, model } = build(flight());
    model.findOneAndUpdate.mockResolvedValueOnce(null);
    await expect(service.cancel('f1', moderator)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('FlightManagementService bookings and export (FLT-29)', () => {
  it('shows the bookings page with seats remaining per cabin', async () => {
    const { service, link } = build(flight());
    const view = await service.listBookings('f1', moderator, {
      page: 2,
      limit: 10,
    });
    expect(link.listBookings).toHaveBeenCalledWith('f1', {
      skip: 10,
      limit: 10,
    });
    expect(view.cabins).toEqual([
      { cabinClass: CabinClass.ECONOMY, totalSeats: 100, seatsRemaining: 65 },
    ]);
    expect(view.bookings).toMatchObject({ total: 1, page: 2, limit: 10 });
  });

  it('is empty, not an error, when no booking module is connected yet', async () => {
    const { service } = build(flight(), false);
    const view = await service.listBookings('f1', moderator, {
      page: 1,
      limit: 10,
    });
    expect(view.bookings.items).toEqual([]);
  });

  it('keeps bookings private to the airline’s own moderator', async () => {
    const { service, link } = build(flight());
    await expect(
      service.listBookings('f1', stranger, { page: 1, limit: 10 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.exportPassengers('f1', { id: 'u1', role: Role.USER }),
    ).rejects.toMatchObject({ status: 403 });
    expect(link.listBookings).not.toHaveBeenCalled();
  });

  it('shows bookings of a Cancelled flight too', async () => {
    const { service } = build(flight({ status: FlightStatus.CANCELLED }));
    const view = await service.listBookings('f1', moderator, {
      page: 1,
      limit: 10,
    });
    expect(view.flight.status).toBe(FlightStatus.CANCELLED);
  });

  it('exports one CSV line per passenger and protects against formulas', async () => {
    const { service, link } = build(flight());
    const { filename, csv } = await service.exportPassengers('f1', moderator);
    expect(link.listBookings).toHaveBeenCalledWith('f1');
    expect(filename).toBe('MS985-2090-03-01-passengers.csv');
    expect(csv.split('\r\n')).toEqual([
      'Booking reference,Passenger,Cabin,Seats,Status',
      'FB-1,Ana Hassan,Economy,2,Confirmed',
      "FB-1,'=cmd|evil,Economy,2,Confirmed",
      '',
    ]);
  });
});
