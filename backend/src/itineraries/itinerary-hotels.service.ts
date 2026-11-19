import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import type { Paginated } from '../common/pagination/pagination';
import type { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';
import { HotelSearchHook, hotelCriteriaFor } from './hotel-search';
import type { HotelSearchCriteria } from './hotel-search';
import { buildGroups } from './itinerary-dates';
import type { CityGroup } from './itinerary-dates';
import { ItineraryRepository } from './itinerary.repository';

type Caller = Pick<AuthUser, 'id' | 'role'>;

export interface ItineraryHotelSearch {
  itineraryId: string;
  /** The city group the hotels were searched for. */
  group: Omit<CityGroup, 'dayIds' | 'dayCount'> & { number: number };
  /** The dates and party that were searched. */
  search: HotelSearchCriteria;
  hotels: Paginated<unknown>;
}

/**
 * ITN-25: hotels for one city group of the traveller's own itinerary. Checks
 * in on the group's first day and out the day after its last, and reuses the
 * hotel search (HTL-11) through `HotelSearchHook`.
 */
@Injectable()
export class ItineraryHotelsService {
  constructor(
    private readonly repository: ItineraryRepository,
    private readonly hook: HotelSearchHook,
  ) {}

  async search(
    user: Caller,
    itineraryId: string,
    query: ItineraryHotelsQueryDto,
  ): Promise<ItineraryHotelSearch> {
    const itinerary = await this.repository.loadOwned(itineraryId, user);
    const groups = buildGroups(
      itinerary.days.map((day) => ({ id: day._id.toString(), city: day.city })),
      itinerary.startDate,
    );
    const criteria = hotelCriteriaFor(groups, query.group, {
      guests: query.guests,
      rooms: query.rooms,
    });

    const port = this.hook.get();
    if (!port) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The hotel search is not connected yet',
        code: 'HOTEL_SEARCH_UNAVAILABLE',
      });
    }
    const hotels = await port.search({
      ...criteria,
      page: query.page,
      limit: query.limit,
    });
    const chosen = groups[query.group - 1];
    return {
      itineraryId: itinerary.id,
      group: {
        number: query.group,
        city: chosen.city,
        startDay: chosen.startDay,
        endDay: chosen.endDay,
        startDate: chosen.startDate,
        endDate: chosen.endDate,
      },
      search: criteria,
      hotels,
    };
  }
}
