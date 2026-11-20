import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import type { Paginated } from '../../common/pagination/pagination';
import { ApiReq } from '../../common/swagger/api-req.decorator';
import { AvailableRoomsQueryDto } from '../dto/available-rooms-query.dto';
import { SearchHotelsQueryDto } from '../dto/search-hotels.dto';
import { HotelSearchService } from './hotel-search.service';
import type {
  AvailableRoomsView,
  HotelSearchRow,
} from './hotel-search.service';

const SEARCH_ROW = {
  id: '665f1c2a9b1e8a0012345670',
  name: 'Nile View Hotel',
  address: '12 Corniche El Nil',
  city: 'cairo',
  country: 'EG',
  starClass: 4,
  amenities: ['wifi', 'pool'],
  photo: '/uploads/3f1c2b9e-8a7d-4c1e-9b2a-1d4e5f6a7b8c.jpg',
  rating: { averageRating: 4.5, ratingCount: 12 },
  pricePerNight: 90,
  freeRooms: 3,
};

/**
 * Hotel search and free rooms (HTL-11, 12, 15). Open to everyone.
 *
 * Listed **before** `HotelsController` in `HotelsModule`: its `GET :id` matches
 * any single segment, so `GET hotels/search` would otherwise be read as a hotel
 * with the id "search".
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelSearchController {
  constructor(private readonly search: HotelSearchService) {}

  @Get('search')
  @Public()
  @ApiReq(
    ['HTL-11', 'HTL-12'],
    'Search hotels',
    'Open to guests. Send a `city` or a `country`, `checkIn`, `checkOut`, `guests` and `rooms` (default 1). Lists active hotels with at least that many rooms free for the whole stay (active, inside the room availability, not blocked, not taken by a Confirmed reservation or an unexpired hold) whose combined maximum occupancy covers the guests. Check-out must be after check-in, check-in cannot be in the past and a stay is at most 30 nights. Optional inclusive `minPrice` / `maxPrice` per night (of the cheapest free room) and `minRating` (1 to 5; unrated hotels are left out when it is set); sort by `price` or `rating` with `order`; paginated (10 per page).',
  )
  @ApiOkResponse({
    schema: {
      example: { items: [SEARCH_ROW], total: 1, page: 1, limit: 10 },
    },
  })
  @ApiBadRequestResponse({
    description:
      'No city or country, check-out not after check-in, check-in in the past, an impossible date, more rooms than guests, a minimum price above the maximum, a stay over 30 nights',
  })
  find(
    @Query() query: SearchHotelsQueryDto,
  ): Promise<Paginated<HotelSearchRow>> {
    return this.search.search(query);
  }

  @Get(':id/rooms/available')
  @Public()
  @ApiReq(
    'HTL-15',
    'Free rooms of a hotel for the dates',
    'Open to guests. Every room of the hotel that is free for the whole stay, cheapest first, with type, beds, maximum occupancy, price per night and the total stay price (price per night x nights). Pick one or more of them for POST /api/hotel-bookings. A deactivated hotel is hidden (404) except from admins and its own moderator.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({
    schema: {
      example: {
        hotelId: '665f1c2a9b1e8a0012345670',
        checkIn: '2027-03-10',
        checkOut: '2027-03-13',
        nights: 3,
        rooms: [
          {
            id: '665f1c2a9b1e8a0012345671',
            name: '101',
            type: 'Double',
            beds: 2,
            maxOccupancy: 3,
            pricePerNight: 90,
            totalPrice: 270,
          },
        ],
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Check-out not after check-in, check-in in the past, an impossible date, or a stay over 30 nights',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  available(
    @Param('id') id: string,
    @Query() query: AvailableRoomsQueryDto,
    @CurrentUser() user?: AuthUser,
  ): Promise<AvailableRoomsView> {
    return this.search.availableRooms(id, query, user);
  }
}
