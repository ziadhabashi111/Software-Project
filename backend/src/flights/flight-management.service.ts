import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { NOTIFICATION_SERVICE } from '../notifications/notification.service.interface';
import type { NotificationService } from '../notifications/notification.service.interface';
import { assertOwnAirline } from './airline-access';
import { toCsv } from './csv';
import { FlightBookingHooks } from './flight-booking-hooks';
import type { FlightBookingRow } from './flight-booking-hooks';
import { seatsRemaining } from './flight-rules';
import { effectiveStatus, FlightStatus } from './flight-status';
import type { CabinClass } from './flight-status';
import { FlightsService } from './flights.service';
import type { FlightView } from './flight-view';
import { Flight } from './schemas/flight.schema';
import type { FlightDocument } from './schemas/flight.schema';

export interface FlightCancellationResult {
  flight: FlightView;
  /** Confirmed bookings that were cancelled and refunded in full. */
  cancelledBookings: number;
  /** Passengers who received an in-app notification. */
  notifiedPassengers: number;
}

export interface FlightBookingsView {
  flight: {
    id: string;
    flightNumber: string;
    status: FlightStatus;
  };
  /** Seats remaining per cabin category (FLT-29). */
  cabins: {
    cabinClass: CabinClass;
    totalSeats: number;
    seatsRemaining: number;
  }[];
  bookings: Paginated<FlightBookingRow>;
}

/** FLT-06 and FLT-29: cancelling a flight and the moderator's booking views. */
@Injectable()
export class FlightManagementService {
  private readonly logger = new Logger(FlightManagementService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly flightsService: FlightsService,
    private readonly bookings: FlightBookingHooks,
    @Optional()
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications?: NotificationService,
  ) {}

  /**
   * FLT-06: the flight becomes Cancelled first (so it disappears from search
   * and no new hold can start), then every Confirmed booking is cancelled
   * with a 100% refund and holds are released. If that second step fails the
   * flight stays Cancelled and the same request can be sent again to finish.
   */
  async cancel(id: string, user: AuthUser): Promise<FlightCancellationResult> {
    const flight = await this.loadOwned(id, user);
    const alreadyCancelled = flight.status === FlightStatus.CANCELLED;
    if (
      !alreadyCancelled &&
      effectiveStatus(flight) !== FlightStatus.SCHEDULED
    ) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `Only Scheduled flights can be cancelled (this flight is ${effectiveStatus(flight)})`,
        code: 'FLIGHT_NOT_SCHEDULED',
      });
    }

    let current = flight;
    if (!alreadyCancelled) {
      const updated = await this.flights.findOneAndUpdate(
        {
          _id: flight._id,
          status: FlightStatus.SCHEDULED,
          departureUtc: { $gt: new Date() },
        },
        { $set: { status: FlightStatus.CANCELLED } },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message:
            'The flight changed while you were cancelling it. Reload it and try again.',
          code: 'FLIGHT_CHANGED',
        });
      }
      current = updated;
    }

    const link = this.bookings.get();
    // Read the passengers before their bookings change state.
    const passengerIds = link
      ? await link.getConfirmedPassengerUserIds(current.id)
      : [];
    const outcome = link
      ? await link.cancelBookingsForFlight(current.id)
      : { cancelled: 0 };
    const notified = await this.notifyCancelled(current, passengerIds);

    return {
      flight: await this.flightsService.view(current),
      cancelledBookings: outcome.cancelled,
      notifiedPassengers: notified,
    };
  }

  /** FLT-29: bookings of one flight with seats remaining per cabin. */
  async listBookings(
    id: string,
    user: AuthUser,
    page: { page: number; limit: number },
  ): Promise<FlightBookingsView> {
    const flight = await this.loadOwned(id, user);
    const link = this.bookings.get();
    const result = link
      ? await link.listBookings(flight.id, {
          skip: skipFor(page),
          limit: page.limit,
        })
      : { items: [], total: 0 };
    return {
      flight: {
        id: flight.id,
        flightNumber: flight.flightNumber,
        status: effectiveStatus(flight),
      },
      cabins: flight.cabins.map((cabin) => ({
        cabinClass: cabin.cabinClass,
        totalSeats: cabin.totalSeats,
        seatsRemaining: seatsRemaining(cabin),
      })),
      bookings: toPage(result.items, result.total, page),
    };
  }

  /** FLT-29: the whole passenger list as CSV, one line per passenger. */
  async exportPassengers(
    id: string,
    user: AuthUser,
  ): Promise<{ filename: string; csv: string }> {
    const flight = await this.loadOwned(id, user);
    const link = this.bookings.get();
    const { items } = link
      ? await link.listBookings(flight.id)
      : { items: [] as FlightBookingRow[] };
    const rows = items.flatMap((booking) =>
      booking.passengerNames.map((name) => [
        booking.reference,
        name,
        booking.cabinClass,
        booking.seats,
        booking.status,
      ]),
    );
    return {
      filename: `${flight.flightNumber}-${flight.departureLocalDate}-passengers.csv`,
      csv: toCsv(
        ['Booking reference', 'Passenger', 'Cabin', 'Seats', 'Status'],
        rows,
      ),
    };
  }

  /** The flight, for its own airline's moderator, in any status (history stays visible). */
  private async loadOwned(id: string, user: AuthUser): Promise<FlightDocument> {
    const flight = await this.flights.findById(id);
    if (!flight) throw new NotFoundException('Flight not found');
    assertOwnAirline(user, flight.airlineId.toString());
    return flight;
  }

  /** Best effort: the flight is already cancelled and the refunds are issued. */
  private async notifyCancelled(
    flight: FlightDocument,
    userIds: string[],
  ): Promise<number> {
    const notifications = this.notifications;
    if (!notifications || userIds.length === 0) return 0;
    const message = `Flight ${flight.flightNumber} on ${flight.departureLocalDate} was cancelled by the airline. Your booking is cancelled and you will receive a full refund.`;
    let sent = 0;
    for (const userId of userIds) {
      try {
        await notifications.notify(userId, 'FLIGHT_CANCELLED', message);
        sent += 1;
      } catch (error) {
        this.logger.error(
          `Could not notify user ${userId} about flight ${flight.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return sent;
  }
}
