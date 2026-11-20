import { effectiveStatus, FlightStatus } from './flight-status';
import type { CabinClass } from './flight-status';
import { seatsRemaining } from './flight-rules';
import type { AirlineDocument } from './schemas/airline.schema';
import type { AirportDocument } from './schemas/airport.schema';
import type { FlightDocument } from './schemas/flight.schema';
import { durationMinutes, utcToLocal } from './time-zones';
import { seatsPerRowOf } from './seat-layout';

export interface FlightEndView {
  airport: {
    iataCode: string;
    name: string;
    cityId: string;
    timeZone: string;
  };
  /** The instant in UTC (ISO 8601). */
  utc: string;
  /** Local date and time at this airport (GEN-06). */
  localDate: string;
  localTime: string;
  utcOffset: string;
}

export interface CabinView {
  id: string;
  cabinClass: CabinClass;
  price: number;
  totalSeats: number;
  seatsRemaining: number;
  freeBags: number;
  maxBagWeightKg: number;
  /** Seats per row of the seat map (FLT-28). */
  seatsPerRow: number;
}

export interface FlightView {
  id: string;
  airline: { id: string; name: string; code: string };
  flightNumber: string;
  status: FlightStatus;
  departure: FlightEndView;
  arrival: FlightEndView;
  durationMinutes: number;
  cabins: CabinView[];
}

function endView(airport: AirportDocument, instant: Date): FlightEndView {
  const local = utcToLocal(instant, airport.timeZone);
  return {
    airport: {
      iataCode: airport.iataCode,
      name: airport.name,
      cityId: airport.cityId,
      timeZone: airport.timeZone,
    },
    utc: instant.toISOString(),
    localDate: local.date,
    localTime: local.time,
    utcOffset: local.offset,
  };
}

export function toCabinView(
  cabin: FlightDocument['cabins'][number],
): CabinView {
  return {
    id: cabin._id.toString(),
    cabinClass: cabin.cabinClass,
    price: cabin.price,
    totalSeats: cabin.totalSeats,
    seatsRemaining: seatsRemaining(cabin),
    freeBags: cabin.freeBags,
    maxBagWeightKg: cabin.maxBagWeightKg,
    seatsPerRow: seatsPerRowOf(cabin),
  };
}

/** The one flight shape returned by every flight endpoint (FLT-17, GEN-06). */
export function toFlightView(
  flight: FlightDocument,
  airline: Pick<AirlineDocument, 'id' | 'name' | 'code'>,
  departureAirport: AirportDocument,
  arrivalAirport: AirportDocument,
  now: Date = new Date(),
): FlightView {
  return {
    id: flight.id,
    airline: { id: airline.id, name: airline.name, code: airline.code },
    flightNumber: flight.flightNumber,
    status: effectiveStatus(flight, now),
    departure: endView(departureAirport, flight.departureUtc),
    arrival: endView(arrivalAirport, flight.arrivalUtc),
    durationMinutes: durationMinutes(flight.departureUtc, flight.arrivalUtc),
    cabins: flight.cabins.map(toCabinView),
  };
}
