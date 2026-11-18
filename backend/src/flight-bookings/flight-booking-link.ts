import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../common/booking-status/booking-status';
import {
  FlightBookingHooks,
  FlightBookingLink,
  FlightBookingRow,
} from '../flights/flight-booking-hooks';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { FlightBookingCancellationsService } from './flight-booking-cancellations.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

/**
 * What the flights module (Youssef) needs from flight bookings, registered
 * with his `FlightBookingHooks` so his module never imports this one:
 * passengers to notify (FLT-05), the cascade when a flight is cancelled
 * (FLT-06) and the airline's bookings list and CSV (FLT-29).
 */
@Injectable()
export class FlightBookingLinkAdapter
  implements FlightBookingLink, OnModuleInit
{
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    private readonly hooks: FlightBookingHooks,
    private readonly cancellations: FlightBookingCancellationsService,
  ) {}

  onModuleInit(): void {
    this.hooks.register(this);
  }

  async getConfirmedPassengerUserIds(flightId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(flightId)) return [];
    const ids = await this.bookings.distinct('user', {
      'segments.flight': new Types.ObjectId(flightId),
      status: BookingStatus.CONFIRMED,
    });
    return ids.map((id) => String(id));
  }

  /**
   * FLT-06. Returns who was notified too: each user is notified right after
   * their booking is cancelled, so a retry never skips anyone.
   */
  cancelBookingsForFlight(
    flightId: string,
  ): Promise<{ cancelled: number; notifiedUserIds: string[] }> {
    return this.cancellations.cancelForFlight(flightId);
  }

  /**
   * FLT-29: bookings of the flight, newest first. Completed bookings (the
   * passengers flew) are listed as Confirmed.
   */
  async listBookings(
    flightId: string,
    page?: { skip: number; limit: number },
  ): Promise<{ items: FlightBookingRow[]; total: number }> {
    if (!Types.ObjectId.isValid(flightId)) return { items: [], total: 0 };
    const id = new Types.ObjectId(flightId);
    const filter = {
      'segments.flight': id,
      status: {
        $in: [
          BookingStatus.CONFIRMED,
          BookingStatus.COMPLETED,
          BookingStatus.CANCELLED,
        ],
      },
    };
    let query = this.bookings.find(filter).sort({ createdAt: -1, _id: -1 });
    if (page) query = query.skip(page.skip).limit(page.limit);
    const [docs, total] = await Promise.all([
      query,
      this.bookings.countDocuments(filter),
    ]);
    return {
      items: docs.map((doc) => {
        const segment =
          doc.segments.find((s) => s.flight.equals(id)) ?? doc.segments[0];
        return {
          reference: doc.reference ?? '',
          passengerNames: doc.passengers.map((p) => p.fullName),
          cabinClass: segment.cabinClass,
          seats: doc.seats,
          status:
            doc.status === BookingStatus.CANCELLED ? 'Cancelled' : 'Confirmed',
        };
      }),
      total,
    };
  }

  /**
   * ACC-15: travellers with a Confirmed booking on the airline's upcoming
   * flights, to notify when the airline is deactivated. Waiting on the
   * flights module to call it.
   */
  async getConfirmedUserIdsForAirline(airlineId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(airlineId)) return [];
    const upcoming = await this.flights
      .find({
        airlineId: new Types.ObjectId(airlineId),
        departureUtc: { $gt: new Date() },
      })
      .select('_id')
      .lean();
    if (upcoming.length === 0) return [];
    const ids = await this.bookings.distinct('user', {
      'segments.flight': { $in: upcoming.map((f) => f._id) },
      status: BookingStatus.CONFIRMED,
    });
    return ids.map((id) => String(id));
  }
}
