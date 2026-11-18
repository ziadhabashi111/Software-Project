import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { BookingStatus } from '../common/booking-status/booking-status';
import type { CabinClass } from '../flights/flight-status';
import type { PassengerType } from '../flights/passenger-rules';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import { Airport, AirportDocument } from '../flights/schemas/airport.schema';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { durationMinutes, utcToLocal } from '../flights/time-zones';
import type { UserRefundQuote } from './rules/cancellation-rules';
import { statusLabel } from './rules/status-labels';
import type {
  FlightBookingDocument,
  TripType,
} from './schemas/flight-booking.schema';

/** One end of a flight in its airport's local time (GEN-06), as in the flight view. */
export interface EndView {
  airport: { iataCode: string; name: string; cityId: string; timeZone: string };
  /** The instant in UTC (ISO 8601). */
  utc: string;
  localDate: string;
  localTime: string;
  utcOffset: string;
}

export interface SegmentView {
  flightId: string;
  flightNumber: string;
  airline: { id: string; name: string; code: string };
  cabinClass: CabinClass;
  departure: EndView;
  arrival: EndView;
  durationMinutes: number;
}

export interface BookedSegmentView extends SegmentView {
  /** The flight's current status (Scheduled, Cancelled, Departed). */
  flightStatus: string;
  farePerSeat: number;
  freeBags: number;
  maxBagWeightKg: number;
  extraBagPrice: number;
}

/** A flight booking as its owner (or an admin) sees it (FLT-25, PAY-01, PAY-03). */
export interface FlightBookingView {
  id: string;
  /** Set once the booking is Confirmed (FLT-23). */
  reference: string | null;
  status: BookingStatus;
  statusLabel: string;
  tripType: TripType;
  segments: BookedSegmentView[];
  passengers: {
    fullName: string;
    dateOfBirth: string;
    documentNumber: string;
    type: PassengerType;
    extraBags: number;
    extraBagWeightKg: number | null;
    fare: number;
    baggageFee: number;
  }[];
  seats: number;
  price: {
    fares: number;
    baggage: number;
    total: number;
    perSegment: number[];
  };
  currency: string;
  policies: {
    cancellationTiers: { daysBefore: number; refundPercent: number }[];
    baggagePolicy: { extraBagPrice: number; maxExtraBags: number } | null;
  };
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: 'user' | 'airline' | null;
  payment: {
    paymentIntentId: string | null;
    amount: number | null;
    currency: string | null;
    status: string | null;
  } | null;
  refund: {
    refundId: string | null;
    percent: number;
    amount: number;
    currency: string;
    /** PENDING, REFUNDED or FAILED (PAY-03); null when nothing is refunded. */
    status: string | null;
    /** Why the refund failed (a short code such as `STRIPE_<CODE>`), when FAILED. */
    failureReason: string | null;
  } | null;
  /** What cancelling now would refund; only while the booking can be cancelled (FLT-26). */
  cancellation?: UserRefundQuote | null;
  createdAt: string;
}

/**
 * Builds every flight booking response. Times and airports are read live from
 * the flights, in each airport's local zone (GEN-06), so an airline's
 * schedule change (FLT-05) shows up on the booking and the e-ticket.
 */
@Injectable()
export class FlightBookingViews {
  constructor(
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
  ) {}

  /** Airports of the given codes, by IATA code. */
  async airportsFor(codes: string[]): Promise<Map<string, AirportDocument>> {
    const docs = await this.airports.find({
      iataCode: { $in: [...new Set(codes)] },
    });
    return new Map(docs.map((doc) => [doc.iataCode, doc]));
  }

  segmentView(
    flight: FlightDocument,
    airline: AirlineDocument | null,
    cabinClass: CabinClass,
    airports: Map<string, AirportDocument>,
  ): SegmentView {
    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      airline: {
        id: flight.airlineId.toString(),
        name: airline?.name ?? '',
        code: airline?.code ?? '',
      },
      cabinClass,
      departure: endView(
        flight.departureAirport,
        flight.departureUtc,
        airports,
      ),
      arrival: endView(flight.arrivalAirport, flight.arrivalUtc, airports),
      durationMinutes: durationMinutes(flight.departureUtc, flight.arrivalUtc),
    };
  }

  async bookingView(doc: FlightBookingDocument): Promise<FlightBookingView> {
    const [view] = await this.bookingViews([doc]);
    return view;
  }

  /** Views of several bookings with one query per collection. */
  async bookingViews(
    docs: FlightBookingDocument[],
  ): Promise<FlightBookingView[]> {
    const flightIds = unique(
      docs.flatMap((d) => d.segments.map((s) => s.flight)),
    );
    const flights = await this.flights.find({ _id: { $in: flightIds } });
    const flightById = new Map(flights.map((f) => [f.id, f]));
    const airlines = await this.airlines.find({
      _id: { $in: unique(flights.map((f) => f.airlineId)) },
    });
    const airlineById = new Map(airlines.map((a) => [a.id, a]));
    const airports = await this.airportsFor(
      flights.flatMap((f) => [f.departureAirport, f.arrivalAirport]),
    );

    return docs.map((doc) => ({
      id: doc.id,
      reference: doc.reference ?? null,
      status: doc.status,
      statusLabel: statusLabel(doc.status),
      tripType: doc.tripType,
      segments: doc.segments.flatMap((segment) => {
        const flight = flightById.get(segment.flight.toString());
        if (!flight) return [];
        return [
          {
            ...this.segmentView(
              flight,
              airlineById.get(flight.airlineId.toString()) ?? null,
              segment.cabinClass,
              airports,
            ),
            flightStatus: flight.status,
            farePerSeat: segment.farePerSeat,
            freeBags: segment.freeBags,
            maxBagWeightKg: segment.maxBagWeightKg,
            extraBagPrice: segment.extraBagPrice,
          },
        ];
      }),
      passengers: doc.passengers.map((p) => ({
        fullName: p.fullName,
        dateOfBirth: p.dateOfBirth.toISOString().slice(0, 10),
        documentNumber: p.documentNumber,
        type: p.type,
        extraBags: p.extraBags,
        extraBagWeightKg: p.extraBagWeightKg ?? null,
        fare: p.fare,
        baggageFee: p.baggageFee,
      })),
      seats: doc.seats,
      price: {
        fares: doc.price.fares,
        baggage: doc.price.baggage,
        total: doc.price.total,
        perSegment: [...doc.price.perSegment],
      },
      currency: doc.currency,
      policies: {
        cancellationTiers: doc.cancellationTiers.map((t) => ({
          daysBefore: t.daysBefore,
          refundPercent: t.refundPercent,
        })),
        baggagePolicy: doc.baggagePolicy
          ? {
              extraBagPrice: doc.baggagePolicy.extraBagPrice,
              maxExtraBags: doc.baggagePolicy.maxExtraBags,
            }
          : null,
      },
      holdExpiresAt: iso(doc.holdExpiresAt),
      confirmedAt: iso(doc.confirmedAt),
      cancelledAt: iso(doc.cancelledAt),
      cancelledBy: doc.cancelledBy ?? null,
      payment: doc.payment?.status
        ? {
            paymentIntentId: doc.payment.paymentIntentId ?? null,
            amount: doc.payment.amount ?? null,
            currency: doc.payment.currency ?? null,
            status: doc.payment.status,
          }
        : null,
      refund: doc.refund
        ? {
            refundId: doc.refund.refundId ?? null,
            percent: doc.refund.percent,
            amount: doc.refund.amount,
            currency: doc.refund.currency,
            status: doc.refund.status ?? null,
            failureReason: doc.refund.failureReason ?? null,
          }
        : null,
      createdAt: doc.createdAt.toISOString(),
    }));
  }
}

function iso(date: Date | undefined): string | null {
  return date ? date.toISOString() : null;
}

function unique(ids: Types.ObjectId[]): Types.ObjectId[] {
  const seen = new Map(ids.map((id) => [id.toString(), id]));
  return [...seen.values()];
}

function endView(
  code: string,
  instant: Date,
  airports: Map<string, AirportDocument>,
): EndView {
  const airport = airports.get(code);
  // An airport missing from the reference list falls back to UTC.
  const timeZone = airport?.timeZone ?? 'UTC';
  const local = utcToLocal(instant, timeZone);
  return {
    airport: {
      iataCode: code,
      name: airport?.name ?? code,
      cityId: airport?.cityId ?? '',
      timeZone,
    },
    utc: instant.toISOString(),
    localDate: local.date,
    localTime: local.time,
    utcOffset: local.offset,
  };
}
