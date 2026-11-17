import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { fieldError } from '../common/validation/validation-errors';
import { AirportsService } from '../flights/airports.service';
import { FlightSearchService } from '../flights/flight-search.service';
import type { FlightSearchResult } from '../flights/flight-search.service';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import { addDays, formatDate } from './itinerary-dates';
import { ItineraryRepository } from './itinerary.repository';

export interface ItineraryFlightSearch extends FlightSearchResult {
  /** What was actually searched, including the defaults that were filled in. */
  searched: {
    originAirport: string;
    destinationCity: string;
    destinationAirports: string[];
    date: string;
    returnDate: string | null;
  };
}

/** ITN-26: flights from a chosen origin to the city of the itinerary's first day. */
@Injectable()
export class ItineraryFlightsService {
  constructor(
    private readonly itineraries: ItineraryRepository,
    private readonly airports: AirportsService,
    private readonly flights: FlightSearchService,
  ) {}

  async search(
    user: Pick<AuthUser, 'id' | 'role'>,
    itineraryId: string,
    query: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightSearch> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    if (itinerary.days.length === 0) {
      throw fieldError(
        'itinerary',
        'Add at least one day to the itinerary before searching flights',
      );
    }
    const city = itinerary.days[0].city;

    // Dates: the outbound defaults to the start date, the return to the last day (ITN-26).
    const date = query.date ?? formatDate(itinerary.startDate);
    const roundTrip =
      query.roundTrip === true || query.returnDate !== undefined;
    const returnDate = roundTrip
      ? (query.returnDate ??
        formatDate(addDays(itinerary.startDate, itinerary.days.length - 1)))
      : null;

    await this.flights.requireListed({ from: query.from });
    const destinations = await this.airports.findByCity(city);
    const destinationAirports = destinations.map((a) => a.iataCode).sort();
    if (destinationAirports.includes(query.from)) {
      throw fieldError(
        'from',
        `You are already in ${city}: choose an origin airport outside the city`,
      );
    }

    const searched = {
      originAirport: query.from,
      destinationCity: city,
      destinationAirports,
      date,
      returnDate,
    };
    if (destinationAirports.length === 0) {
      const empty = {
        items: [],
        total: 0,
        page: query.page,
        limit: query.limit,
      };
      return {
        outbound: empty,
        return: returnDate ? empty : null,
        message: `There is no airport in ${city} in our airport list`,
        searched,
      };
    }

    const result = await this.flights.searchRoutes({
      departureAirports: [query.from],
      arrivalAirports: destinationAirports,
      date,
      ...(returnDate ? { returnDate } : {}),
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
    return { ...result, searched };
  }
}
