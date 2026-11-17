import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto';
import { ItineraryFlightsService } from './itinerary-flights.service';
import type { ItineraryFlightSearch } from './itinerary-flights.service';

/** Flight search from an itinerary (ITN-26). Owner only: anyone else gets 404. */
@ApiTags('itineraries')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@Controller('itineraries')
export class ItineraryFlightsController {
  constructor(private readonly flights: ItineraryFlightsService) {}

  @Get(':id/flights')
  @ApiReq(
    ['ITN-26', 'FLT-11', 'FLT-12'],
    'Search flights to the itinerary’s first city',
    'Flights from the chosen origin airport (`from`) to any airport in the city of the itinerary’s first day. The outbound date defaults to the start date. Add `roundTrip=true` for a round trip: the return date defaults to the date of the last day (or pass `returnDate`). Passengers, cabin class, price range, sorting and paging work exactly like GET /api/flights/search. `searched` shows the airports and dates that were used.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({
    schema: {
      example: {
        outbound: { items: [], total: 0, page: 1, limit: 10 },
        return: null,
        message: 'No flights found',
        searched: {
          originAirport: 'CAI',
          destinationCity: 'paris',
          destinationAirports: ['CDG'],
          date: '2027-03-01',
          returnDate: null,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Itinerary has no days, origin not in the airport list or inside the destination city, no adult, more infants than adults, min price above max price, return before outbound',
  })
  @ApiNotFoundResponse({ description: 'Itinerary not found' })
  search(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightSearch> {
    return this.flights.search(user, id, query);
  }
}
