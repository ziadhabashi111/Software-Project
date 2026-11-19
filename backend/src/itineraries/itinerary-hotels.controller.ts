import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import type { ItineraryHotelSearch } from './itinerary-hotels.service';

/** Hotels for a city group of an itinerary (ITN-25). Owner only: anyone else gets 404. */
@ApiTags('itineraries')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@Controller('itineraries')
export class ItineraryHotelsController {
  constructor(private readonly hotels: ItineraryHotelsService) {}

  @Get(':id/hotels')
  @ApiReq(
    ['ITN-25', 'HTL-11'],
    'Find hotels for a city group of my itinerary',
    'Searches the hotels of the chosen city group (`group`, counted from 1): check-in is the first day of the group and check-out the day after its last day. Add `guests` and `rooms` (each room needs a guest). It reuses the hotel search, so filters, ordering and paging work as in GET /api/hotels/search. `search` shows the dates and party that were used.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({
    description: 'The city group, the dates searched and a page of hotels',
  })
  @ApiBadRequestResponse({
    description: 'No such city group, no days yet, or more rooms than guests',
  })
  @ApiNotFoundResponse({ description: 'Itinerary not found, or not yours' })
  @ApiServiceUnavailableResponse({
    description: 'The hotel search is not connected yet',
  })
  search(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ItineraryHotelsQueryDto,
  ): Promise<ItineraryHotelSearch> {
    return this.hotels.search(user, id, query);
  }
}
