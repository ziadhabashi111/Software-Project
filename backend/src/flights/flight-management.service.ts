import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
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
  /** Passengers the booking module notified as each booking was cancelled. */
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
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly flightsService: FlightsService,
    private readonly bookings: FlightBookingHooks,
  ) {}

  /**
   * FLT-06: the flight becomes Cancelled first (so it disappears from search
   * and no new hold can start), then every Confirmed booking is cancelled
   * with a 100% refund, holds are released and each passenger is notified by
   * the booking module. If that second step fails the flight stays Cancelled
   * and the same request can be sent again to finish.
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

    // The booking module cancels and refunds each booking and notifies its
    // user right afterwards (FLIGHT_CANCELLED), so a retry never skips anyone
    // and a booking confirmed a moment ago is not left out.
    const link = this.bookings.get();
    const outcome = link
      ? await link.cancelBookingsForFlight(current.id)
      : { cancelled: 0, notifiedUserIds: [] };

    return {
      flight: await this.flightsService.view(current),
      cancelledBookings: outcome.cancelled,
      notifiedPassengers: outcome.notifiedUserIds.length,
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
}
