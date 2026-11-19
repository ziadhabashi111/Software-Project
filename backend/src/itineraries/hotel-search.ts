import { Injectable } from '@nestjs/common';
import type { Paginated } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import { addDays, formatDate, parseDate } from './itinerary-dates';
import type { CityGroup } from './itinerary-dates';

/** What an itinerary asks the hotel search for (ITN-25, HTL-11). */
export interface HotelSearchCriteria {
  city: string;
  /** `YYYY-MM-DD`: the first day of the city group. */
  checkIn: string;
  /** `YYYY-MM-DD`: the day after the last day of the city group. */
  checkOut: string;
  guests: number;
  rooms: number;
}

/**
 * The hotel search (HTL-11, owned by the hotels module) as the itinerary
 * module uses it. The hotels module registers it with `HotelSearchHook`:
 *
 *   constructor(private readonly hook: HotelSearchHook) {}
 *   onModuleInit() { this.hook.register(this); }
 */
export interface HotelSearchPort {
  search(
    criteria: HotelSearchCriteria & { page: number; limit: number },
  ): Promise<Paginated<unknown>>;
}

/** Holds the hotel search once the hotels module registers it. */
@Injectable()
export class HotelSearchHook {
  private port?: HotelSearchPort;

  register(port: HotelSearchPort): void {
    this.port = port;
  }

  get(): HotelSearchPort | undefined {
    return this.port;
  }
}

/**
 * ITN-25: check in on the first day of the chosen city group and check out
 * the day after its last day. `position` is 1-based (the second city stop is
 * group 2). Every room needs at least one guest.
 */
export function hotelCriteriaFor(
  groups: CityGroup[],
  position: number,
  party: { guests: number; rooms: number },
): HotelSearchCriteria {
  if (groups.length === 0) {
    throw fieldError(
      'itinerary',
      'Add at least one day to the itinerary before searching hotels',
    );
  }
  const group = groups[position - 1];
  if (!group) {
    throw fieldError('group', `Choose a city group from 1 to ${groups.length}`);
  }
  if (party.rooms > party.guests) {
    throw fieldError('rooms', 'Every room needs at least one guest');
  }
  return {
    city: group.city,
    checkIn: group.startDate,
    checkOut: formatDate(addDays(parseDate(group.endDate), 1)),
    guests: party.guests,
    rooms: party.rooms,
  };
}
