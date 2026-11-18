import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CabinClass } from '../flights/flight-status';
import type { AirlineDocument } from '../flights/schemas/airline.schema';
import { Airport, AirportDocument } from '../flights/schemas/airport.schema';
import type { FlightDocument } from '../flights/schemas/flight.schema';
import { durationMinutes, utcToLocal } from '../flights/time-zones';

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

/**
 * Builds the time-zone-aware parts of every flight booking response, reading
 * airports so times are shown in each airport's local zone (GEN-06).
 */
@Injectable()
export class FlightBookingViews {
  constructor(
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
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
