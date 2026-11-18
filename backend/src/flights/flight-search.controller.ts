import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { SearchFlightsQueryDto } from './dto/search-flights.dto';
import { FlightSearchService } from './flight-search.service';
import type {
  FlightDetails,
  FlightSearchResult,
} from './flight-search.service';

const FLIGHT_FIELDS = {
  id: '6660a1b2c3d4e5f601234567',
  airline: { id: '665f1c2a9b1e8a0012345670', name: 'EgyptAir', code: 'MS' },
  flightNumber: 'MS985',
  status: 'Scheduled',
  departure: {
    airport: {
      iataCode: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      timeZone: 'Africa/Cairo',
    },
    utc: '2027-03-01T12:30:00.000Z',
    localDate: '2027-03-01',
    localTime: '14:30',
    utcOffset: '+02:00',
  },
  arrival: {
    airport: {
      iataCode: 'JFK',
      name: 'John F. Kennedy International Airport',
      cityId: 'new_york',
      timeZone: 'America/New_York',
    },
    utc: '2027-03-02T00:45:00.000Z',
    localDate: '2027-03-01',
    localTime: '19:45',
    utcOffset: '-05:00',
  },
  durationMinutes: 735,
  cabins: [
    {
      id: '6660a1b2c3d4e5f601234999',
      cabinClass: 'Economy',
      price: 420,
      totalSeats: 150,
      seatsRemaining: 142,
      freeBags: 1,
      maxBagWeightKg: 23,
    },
  ],
};

@ApiTags('flights')
@Controller('flights')
export class FlightSearchController {
  constructor(private readonly search: FlightSearchService) {}

  @Get('search')
  @Public()
  @ApiReq(
    ['FLT-11', 'FLT-12', 'FLT-15'],
    'Search flights',
    'Open to guests. Lists Scheduled flights of active airlines departing on the local date at the departure airport, with enough free seats (total - booked - held) for adults + children in at least one cabin; infants take no seat. Add `returnDate` for a round trip (outbound and return options, booked later as one booking). Optional cabin class and inclusive min/max price filters (400 if min > max); sort by price, duration or departure; paginated (10 per page). Each flight lists only the cabins that match. When nothing matches, `message` says "No flights found". Times are returned in each airport’s local time with the UTC offset (GEN-06).',
  )
  @ApiOkResponse({
    schema: {
      example: {
        outbound: {
          items: [{ ...FLIGHT_FIELDS, fromPrice: 420 }],
          total: 1,
          page: 1,
          limit: 10,
        },
        return: null,
        message: null,
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Airport not in the list, identical airports, no adult, more infants than adults, min price above max price, return before departure',
  })
  find(@Query() query: SearchFlightsQueryDto): Promise<FlightSearchResult> {
    return this.search.search(query);
  }

  @Get(':id')
  @Public()
  @ApiReq(
    'FLT-17',
    'Flight details',
    'Airline, flight number, airports, local departure and arrival times, duration, each cabin with price, seats remaining and baggage allowance, and the airline’s baggage and cancellation policies. A flight of a deactivated airline is hidden (404) except from admins and that airline’s moderator.',
  )
  @ApiOkResponse({
    schema: {
      example: {
        ...FLIGHT_FIELDS,
        baggagePolicy: { extraBagPrice: 25, maxExtraBags: 2 },
        cancellationPolicy: [
          { daysBefore: 14, refundPercent: 100 },
          { daysBefore: 3, refundPercent: 50 },
        ],
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Flight not found or its airline is deactivated',
  })
  get(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<FlightDetails> {
    return this.search.details(id, user);
  }
}
