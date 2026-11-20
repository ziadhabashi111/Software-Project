import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { BookingStatus } from '../common/booking-status/booking-status';
import { assertCanAccess } from '../common/security/ownership';
import { fieldError } from '../common/validation/validation-errors';
import { CabinClass, FlightStatus } from '../flights/flight-status';
import { PassengerType } from '../flights/passenger-rules';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import {
  isSeatInLayout,
  normalizeSeat,
  seatRows,
  seatsPerRowOf,
} from '../flights/seat-layout';
import { PickSeatDto } from './dto/seat.dto';
import { FlightBookingView, FlightBookingViews } from './flight-booking-view';
import { SeatAssignments } from './seat-assignments';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

/** The seat map of one cabin (FLT-28): who sits where is never shown. */
export interface SeatMapView {
  flightId: string;
  cabinClass: CabinClass;
  seatsPerRow: number;
  totalSeats: number;
  rows: { row: number; seats: { label: string; taken: boolean }[] }[];
}

/** FLT-28: the seat map and picking a seat for a passenger. */
@Injectable()
export class SeatSelectionService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    private readonly seats: SeatAssignments,
    private readonly views: FlightBookingViews,
  ) {}

  async seatMap(
    flightId: string,
    cabinClass: CabinClass,
  ): Promise<SeatMapView> {
    const flight = await this.flights.findById(flightId);
    const cabin = flight?.cabins.find((c) => c.cabinClass === cabinClass);
    if (!flight || !cabin) {
      throw new NotFoundException('This flight has no such cabin');
    }
    const perRow = seatsPerRowOf(cabin);
    const taken = new Set(await this.seats.takenSeats(flightId, cabinClass));
    return {
      flightId: flight.id,
      cabinClass,
      seatsPerRow: perRow,
      totalSeats: cabin.totalSeats,
      rows: seatRows(cabin.totalSeats, perRow).map(({ row, seats }) => ({
        row,
        seats: seats.map((label) => ({ label, taken: taken.has(label) })),
      })),
    };
  }

  /**
   * Gives a passenger of the user's own Confirmed booking a seat on one of
   * its flights, replacing their previous seat there. The seat must exist in
   * the cabin, be free (409 SEAT_TAKEN) and the flight must still be
   * Scheduled and not departed (409 SEAT_CHANGE_CLOSED).
   */
  async pick(
    bookingId: string,
    user: AuthUser,
    dto: PickSeatDto,
    now: Date = new Date(),
  ): Promise<FlightBookingView> {
    const booking = await this.bookings.findById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    assertCanAccess(booking.user, user);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw conflict(
        'NOT_CONFIRMED',
        'Seats can be picked once the booking is Confirmed',
      );
    }

    const segmentIndex = dto.segmentIndex ?? 0;
    const segment = booking.segments[segmentIndex];
    if (!segment) {
      throw fieldError('segmentIndex', 'This booking has no such flight');
    }
    const passenger = booking.passengers[dto.passengerIndex];
    if (!passenger) {
      throw fieldError('passengerIndex', 'This booking has no such passenger');
    }
    if (passenger.type === PassengerType.INFANT) {
      throw fieldError(
        'passengerIndex',
        'Infants sit on an adult’s lap and have no seat of their own',
      );
    }
    const seat = normalizeSeat(dto.seat);
    if (!seat) {
      throw fieldError('seat', 'Use a row number and a letter, such as 12C');
    }

    try {
      await this.connection.transaction(async (session) => {
        // Bumping the cabin's seat-map version locks its layout for this
        // pick: a concurrent layout change (FLT-05) fails and is retried.
        const flight = await this.flights.findOneAndUpdate(
          {
            _id: segment.flight,
            status: FlightStatus.SCHEDULED,
            departureUtc: { $gt: now },
            'cabins.cabinClass': segment.cabinClass,
          },
          { $inc: { 'cabins.$[c].seatMapVersion': 1 } },
          {
            arrayFilters: [{ 'c.cabinClass': segment.cabinClass }],
            returnDocument: 'after',
            session,
          },
        );
        if (!flight) {
          throw conflict(
            'SEAT_CHANGE_CLOSED',
            'Seats cannot be changed once the flight is cancelled or has departed',
          );
        }
        const cabin = flight.cabins.find(
          (c) => c.cabinClass === segment.cabinClass,
        );
        if (
          !cabin ||
          !isSeatInLayout(seat, cabin.totalSeats, seatsPerRowOf(cabin))
        ) {
          throw fieldError('seat', `Seat ${seat} does not exist in this cabin`);
        }
        await this.seats.assign(
          {
            flight: segment.flight,
            cabinClass: segment.cabinClass,
            seat,
            booking: booking._id,
            segmentIndex,
            passengerIndex: dto.passengerIndex,
          },
          session,
        );
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw conflict('SEAT_TAKEN', `Seat ${seat} is already taken`);
      }
      throw error;
    }
    return this.views.bookingView(booking);
  }
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
