import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import { isOwnAirlineModerator } from './airline-access';
import { AirlinesService } from './airlines.service';
import { AirportsService } from './airports.service';
import { SearchFlightsQueryDto } from './dto/search-flights.dto';
import { buildSearchPipeline } from './flight-search-pipeline';
import type { FlightCriteria } from './flight-search-pipeline';
import { toFlightView } from './flight-view';
import type { FlightView } from './flight-view';
import { assertPassengerMix, seatsNeeded } from './passenger-rules';
import type { AirportDocument } from './schemas/airport.schema';
import { Flight } from './schemas/flight.schema';
import type { FlightDocument } from './schemas/flight.schema';

export interface FlightSearchItem extends FlightView {
  /** Lowest fare among the cabins that match the search. */
  fromPrice: number;
}

export interface FlightSearchResult {
  outbound: Paginated<FlightSearchItem>;
  /** Present for a round trip (FLT-12). */
  return: Paginated<FlightSearchItem> | null;
  /** "No flights found" when a requested direction has no match (FLT-11). */
  message: string | null;
}

export interface FlightDetails extends FlightView {
  baggagePolicy: { extraBagPrice: number; maxExtraBags: number } | null;
  cancellationPolicy: { daysBefore: number; refundPercent: number }[];
}

interface FacetResult {
  items: Record<string, unknown>[];
  total: { count: number }[];
}

/** FLT-11, FLT-12, FLT-15, FLT-17 and the search reused by itineraries (ITN-26). */
@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly airports: AirportsService,
    private readonly airlines: AirlinesService,
  ) {}

  /** The public search: one-way, or round trip when `returnDate` is given. */
  async search(query: SearchFlightsQueryDto): Promise<FlightSearchResult> {
    if (query.from === query.to) {
      throw fieldError(
        'to',
        'Departure and arrival airports must be different',
      );
    }
    await this.requireListed({ from: query.from, to: query.to });
    return this.searchRoutes({
      departureAirports: [query.from],
      arrivalAirports: [query.to],
      date: query.date,
      ...(query.returnDate ? { returnDate: query.returnDate } : {}),
      adults: query.adults,
      children: query.children,
      infants: query.infants,
      ...(query.cabinClass ? { cabinClass: query.cabinClass } : {}),
      ...(query.minPrice !== undefined ? { minPrice: query.minPrice } : {}),
      ...(query.maxPrice !== undefined ? { maxPrice: query.maxPrice } : {}),
      sortBy: query.sortBy,
      order: query.order,
      page: query.page,
      limit: query.limit,
    });
  }

  /**
   * One-way or round trip between two sets of airports, with the passenger
   * and price rules of FLT-12 and FLT-15. The public search uses one airport
   * on each side; an itinerary searches "any airport in the city" (ITN-26).
   */
  async searchRoutes(params: {
    departureAirports: string[];
    arrivalAirports: string[];
    /** Local departure date, `YYYY-MM-DD`. */
    date: string;
    /** Makes it a round trip: the local date of the return flight. */
    returnDate?: string;
    adults: number;
    children: number;
    infants: number;
    cabinClass?: FlightCriteria['cabinClass'];
    minPrice?: number;
    maxPrice?: number;
    sortBy: FlightCriteria['sortBy'];
    order: FlightCriteria['order'];
    page: number;
    limit: number;
  }): Promise<FlightSearchResult> {
    assertPassengerMix(params.adults, params.infants);
    if (
      params.minPrice !== undefined &&
      params.maxPrice !== undefined &&
      params.minPrice > params.maxPrice
    ) {
      throw fieldError(
        'minPrice',
        'The minimum price cannot be above the maximum price',
      );
    }
    if (params.returnDate && params.returnDate < params.date) {
      throw fieldError(
        'returnDate',
        'The return date cannot be before the departure date',
      );
    }

    const base = {
      seats: seatsNeeded(params.adults, params.children),
      ...(params.cabinClass ? { cabinClass: params.cabinClass } : {}),
      ...(params.minPrice !== undefined ? { minPrice: params.minPrice } : {}),
      ...(params.maxPrice !== undefined ? { maxPrice: params.maxPrice } : {}),
      sortBy: params.sortBy,
      order: params.order,
      page: params.page,
      limit: params.limit,
    };
    const outbound = await this.searchLeg({
      ...base,
      departureAirports: params.departureAirports,
      arrivalAirports: params.arrivalAirports,
      date: params.date,
    });
    const back = params.returnDate
      ? await this.searchLeg({
          ...base,
          departureAirports: params.arrivalAirports,
          arrivalAirports: params.departureAirports,
          date: params.returnDate,
        })
      : null;

    return {
      outbound,
      return: back,
      message: noFlightsMessage(outbound.total, back?.total),
    };
  }

  /**
   * One direction. Takes lists of airports so an itinerary can search "any
   * airport in the city" (ITN-26) with the same rules.
   */
  async searchLeg(params: {
    departureAirports: string[];
    arrivalAirports: string[];
    date: string;
    seats: number;
    cabinClass?: FlightCriteria['cabinClass'];
    minPrice?: number;
    maxPrice?: number;
    sortBy: FlightCriteria['sortBy'];
    order: FlightCriteria['order'];
    page: number;
    limit: number;
  }): Promise<Paginated<FlightSearchItem>> {
    const { page, limit, ...rest } = params;
    const criteria: FlightCriteria = {
      ...rest,
      skip: skipFor({ page, limit }),
      limit,
      now: new Date(),
      activeAirlineIds: await this.airlines.findActiveIds(),
    };
    const [facet] = await this.flights.aggregate<FacetResult>(
      buildSearchPipeline(criteria),
    );
    const rows = facet?.items ?? [];
    const total = facet?.total[0]?.count ?? 0;

    const flights = rows.map((row) => this.flights.hydrate(row));
    const items = await this.toItems(flights, rows);
    return toPage(items, total, { page, limit });
  }

  /** FLT-17: one flight with its policies. Hidden when its airline is deactivated (ACC-15). */
  async details(id: string, user?: AuthUser): Promise<FlightDetails> {
    const flight = await this.flights.findById(id);
    if (!flight) throw new NotFoundException('Flight not found');
    const airlineId = flight.airlineId.toString();
    const airline = await this.airlines.findForFlights(airlineId, {
      includeInactive: true,
    });
    const canSeeInactive =
      user?.role === Role.ADMIN || isOwnAirlineModerator(user, airlineId);
    if (!airline || (!airline.isActive && !canSeeInactive)) {
      throw new NotFoundException('Flight not found');
    }
    const [departure, arrival] = await this.airportsOf(flight);
    return {
      ...toFlightView(flight, airline, departure, arrival),
      baggagePolicy: airline.baggagePolicy
        ? {
            extraBagPrice: airline.baggagePolicy.extraBagPrice,
            maxExtraBags: airline.baggagePolicy.maxExtraBags,
          }
        : null,
      cancellationPolicy: airline.cancellationPolicy.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
    };
  }

  /** FLT-02: search accepts listed airports only. */
  async requireListed(codes: Record<string, string>): Promise<void> {
    const found = await this.airports.findByCodes(Object.values(codes));
    const known = new Set(found.map((a) => a.iataCode));
    for (const [field, code] of Object.entries(codes)) {
      if (!known.has(code)) {
        throw fieldError(
          field,
          `${code} is not in the airport list (see GET /api/airports)`,
        );
      }
    }
  }

  private async airportsOf(
    flight: FlightDocument,
  ): Promise<[AirportDocument, AirportDocument]> {
    const found = await this.airports.findByCodes([
      flight.departureAirport,
      flight.arrivalAirport,
    ]);
    const byCode = new Map(found.map((a) => [a.iataCode, a]));
    const departure = byCode.get(flight.departureAirport);
    const arrival = byCode.get(flight.arrivalAirport);
    if (!departure || !arrival) {
      throw new NotFoundException('Flight data is incomplete');
    }
    return [departure, arrival];
  }

  private async toItems(
    flights: FlightDocument[],
    rows: Record<string, unknown>[],
  ): Promise<FlightSearchItem[]> {
    if (flights.length === 0) return [];
    const codes = [
      ...new Set(
        flights.flatMap((f) => [f.departureAirport, f.arrivalAirport]),
      ),
    ];
    const [airlines, airports] = await Promise.all([
      this.airlines.findByIds([
        ...new Set(flights.map((f) => f.airlineId.toString())),
      ]),
      this.airports.findByCodes(codes),
    ]);
    const airlineById = new Map(airlines.map((a) => [a.id, a]));
    const airportByCode = new Map(airports.map((a) => [a.iataCode, a]));

    return flights.flatMap((flight, index) => {
      const airline = airlineById.get(flight.airlineId.toString());
      const departure = airportByCode.get(flight.departureAirport);
      const arrival = airportByCode.get(flight.arrivalAirport);
      if (!airline || !departure || !arrival) return [];
      return [
        {
          ...toFlightView(flight, airline, departure, arrival),
          fromPrice: Number(rows[index]?.fromPrice ?? 0),
        },
      ];
    });
  }
}

/** FLT-11: "no flights found". For a round trip it says which direction is empty. */
function noFlightsMessage(outbound: number, back?: number): string | null {
  if (back === undefined) return outbound === 0 ? 'No flights found' : null;
  if (outbound === 0 && back === 0) return 'No flights found';
  if (outbound === 0) return 'No outbound flights found';
  if (back === 0) return 'No return flights found';
  return null;
}
