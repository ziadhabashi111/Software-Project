import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import {
  AdminBookingQuery,
  AdminBookingRecord,
  BookingSource,
  BookingSources,
} from '../../admin/booking-sources';
import { BookingStatus } from '../../common/booking-status/booking-status';
import { Airline, AirlineDocument } from '../../flights/schemas/airline.schema';
import { Flight, FlightDocument } from '../../flights/schemas/flight.schema';
import {
  DeactivationBlocker,
  DeactivationBlockers,
} from '../../users/deactivation-blockers';
import { parseStatus } from '../rules/status-labels';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../schemas/flight-booking.schema';

/**
 * Plugs flight bookings into the account and admin modules (Habashi):
 * ACC-12 (no deactivation with an upcoming Confirmed flight) and ACC-17 (the
 * admin's read-only list of all bookings).
 */
@Injectable()
export class FlightBookingRegistrations
  implements DeactivationBlocker, BookingSource, OnModuleInit
{
  readonly type = 'flight' as const;

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly blockers: DeactivationBlockers,
    private readonly sources: BookingSources,
  ) {}

  onModuleInit(): void {
    this.blockers.register(this);
    this.sources.register(this);
  }

  /** ACC-12: a Confirmed booking whose last flight has not landed yet. */
  async hasUpcomingConfirmedBookings(
    userId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const confirmed = await this.bookings
      .find({
        user: new Types.ObjectId(userId),
        status: BookingStatus.CONFIRMED,
      })
      .select('segments.flight')
      .lean();
    if (confirmed.length === 0) return false;
    const flightIds = confirmed.flatMap((b) => b.segments.map((s) => s.flight));
    return (
      (await this.flights.exists({
        _id: { $in: flightIds },
        arrivalUtc: { $gt: now },
      })) !== null
    );
  }

  /**
   * ACC-17: newest first; status accepts `Confirmed` or `CONFIRMED`; the date
   * range applies to the outbound departure. Unpaid holds have no reference.
   */
  async find(
    query: AdminBookingQuery,
  ): Promise<{ items: AdminBookingRecord[]; total: number }> {
    const filter: QueryFilter<FlightBooking> = {};
    if (query.status !== undefined) {
      const status = parseStatus(query.status);
      if (!status) return { items: [], total: 0 };
      filter.status = status;
    }
    if (query.from || query.to) {
      const inRange = await this.flights
        .find({
          departureUtc: {
            ...(query.from ? { $gte: query.from } : {}),
            ...(query.to ? { $lte: query.to } : {}),
          },
        })
        .select('_id')
        .lean();
      filter['segments.0.flight'] = { $in: inRange.map((f) => f._id) };
    }

    const [docs, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit),
      this.bookings.countDocuments(filter),
    ]);
    const flights = await this.flights.find({
      _id: { $in: docs.flatMap((d) => d.segments.map((s) => s.flight)) },
    });
    const flightById = new Map(flights.map((f) => [f.id, f]));
    const airlines = await this.airlines.find({
      _id: { $in: docs.map((d) => d.segments[0].airline) },
    });
    const airlineName = new Map(airlines.map((a) => [a.id, a.name]));

    return {
      items: docs.map((doc): AdminBookingRecord => {
        const outbound = flightById.get(doc.segments[0].flight.toString());
        const last = flightById.get(
          doc.segments[doc.segments.length - 1].flight.toString(),
        );
        const airlineId = doc.segments[0].airline.toString();
        return {
          id: doc.id,
          reference: doc.reference ?? '',
          type: 'flight',
          userId: doc.user.toString(),
          provider: { id: airlineId, name: airlineName.get(airlineId) ?? '' },
          startDate: outbound?.departureUtc ?? doc.createdAt,
          ...(last ? { endDate: last.arrivalUtc } : {}),
          amount: doc.price.total,
          currency: doc.currency,
          status: doc.status,
          createdAt: doc.createdAt,
        };
      }),
      total,
    };
  }
}
