import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import { Paginated, skipFor, toPage } from '../../common/pagination/pagination';
import { fieldError } from '../../common/validation/validation-errors';
import { HotelRatings } from '../../hotel-bookings/hotel-ratings';
import { HotelReservationQueries } from '../../hotel-bookings/hotel-reservation-queries';
import type { RatingSummary } from '../../hotel-bookings/review-view';
import {
  assertValidStay,
  formatDate,
  nightsOf,
  roundMoney,
} from '../../hotel-bookings/stay-rules';
import { HotelSearchHook } from '../../itineraries/hotel-search';
import type { HotelSearchPort } from '../../itineraries/hotel-search';
import { parseRealDay } from '../date-ranges';
import { isOwnHotelModerator } from '../hotel-access';
import { Hotel } from '../schemas/hotel.schema';
import { Room } from '../schemas/room.schema';
import {
  canHost,
  cheapestPrice,
  freeRooms,
  HotelSortBy,
  matchesFilters,
  sortHotels,
  SortOrder,
} from './hotel-search-rules';
import type { HotelFilters, SearchRoom } from './hotel-search-rules';

/** What the hotel search is asked for (HTL-11, HTL-12). */
export interface HotelSearchQuery extends HotelFilters {
  city?: string;
  country?: string;
  /** `YYYY-MM-DD`, the first night. */
  checkIn: string;
  /** `YYYY-MM-DD`, the day the guests leave. */
  checkOut: string;
  guests: number;
  rooms: number;
  sortBy?: HotelSortBy;
  order?: SortOrder;
  page: number;
  limit: number;
}

/** One hotel of the results. */
export interface HotelSearchRow {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  starClass: number;
  amenities: string[];
  /** The first photo, or null. */
  photo: string | null;
  rating: RatingSummary;
  /** Price per night of the cheapest room free for the whole stay (HTL-12). */
  pricePerNight: number;
  /** How many rooms are free for the whole stay. */
  freeRooms: number;
}

/** One free room of a hotel (HTL-15). */
export interface AvailableRoomView {
  id: string;
  name: string;
  type: string | null;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  /** `pricePerNight` x nights. */
  totalPrice: number;
}

export interface AvailableRoomsView {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: AvailableRoomView[];
}

type Caller = Pick<AuthUser, 'id' | 'role' | 'providerId'>;

/**
 * HTL-11 / HTL-12 hotel search and HTL-15 free rooms. A room is free when it is
 * active, every night of the stay is inside its availability and not blocked
 * (the catalogue), and no Confirmed reservation or unexpired hold has taken it
 * (read through the booking module's `HotelReservationQueries`, never its
 * collections). Registered with `HotelSearchHook`, so an itinerary can search
 * hotels for its city groups (ITN-25).
 */
@Injectable()
export class HotelSearchService implements HotelSearchPort, OnModuleInit {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    private readonly queries: HotelReservationQueries,
    private readonly ratings: HotelRatings,
    private readonly hook: HotelSearchHook,
  ) {}

  onModuleInit(): void {
    this.hook.register(this);
  }

  async search(
    query: HotelSearchQuery,
    now: Date = new Date(),
  ): Promise<Paginated<HotelSearchRow>> {
    const { checkIn, checkOut } = this.validate(query, now);

    const hotels = await this.hotels.find({
      isActive: true,
      ...(query.city ? { city: query.city } : {}),
      ...(query.country ? { country: query.country } : {}),
    });
    if (hotels.length === 0) return toPage([], 0, query);

    const rooms = await this.rooms.find({
      hotel: { $in: hotels.map((hotel) => new Types.ObjectId(hotel.id)) },
      isActive: true,
    });
    const taken = await this.queries.takenRoomIds(
      rooms.map((room) => room.id),
      checkIn,
      checkOut,
      now,
    );

    const byHotel = new Map<string, SearchRoom[]>();
    for (const room of rooms) {
      const list = byHotel.get(room.hotel.toString()) ?? [];
      list.push(toSearchRoom(room));
      byHotel.set(room.hotel.toString(), list);
    }
    const candidates = hotels.flatMap((hotel) => {
      const free = freeRooms(
        byHotel.get(hotel.id) ?? [],
        taken,
        checkIn,
        checkOut,
      );
      return canHost(free, query.rooms, query.guests) ? [{ hotel, free }] : [];
    });

    const ratings = await this.ratings.forHotels(
      candidates.map(({ hotel }) => hotel.id),
    );
    const rows = candidates.flatMap(({ hotel, free }): HotelSearchRow[] => {
      const rating = ratings.get(hotel.id) ?? {
        averageRating: null,
        ratingCount: 0,
      };
      const pricePerNight = cheapestPrice(free);
      if (!matchesFilters(pricePerNight, rating.averageRating, query)) {
        return [];
      }
      return [
        {
          id: hotel.id,
          name: hotel.name,
          address: hotel.address,
          city: hotel.city,
          country: hotel.country,
          starClass: hotel.starClass,
          amenities: hotel.amenities,
          photo: hotel.photos[0]?.url ?? null,
          rating,
          pricePerNight,
          freeRooms: free.length,
        },
      ];
    });

    // The row travels with its sort keys, so no lookup is needed afterwards.
    const sorted = sortHotels(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        price: row.pricePerNight,
        rating: row.rating.averageRating,
        row,
      })),
      query.sortBy ?? HotelSortBy.PRICE,
      query.order ?? SortOrder.ASC,
    ).map((sortable) => sortable.row);
    const start = skipFor(query);
    return toPage(
      sorted.slice(start, start + query.limit),
      sorted.length,
      query,
    );
  }

  /** HTL-15: the hotel's rooms free for the dates, with the total stay price. */
  async availableRooms(
    hotelId: string,
    dates: { checkIn: string; checkOut: string },
    user?: Caller,
    now: Date = new Date(),
  ): Promise<AvailableRoomsView> {
    const hotel = Types.ObjectId.isValid(hotelId)
      ? await this.hotels.findById(hotelId)
      : null;
    // The same rule as the hotel page: a deactivated hotel is hidden (ACC-15).
    const canSeeInactive =
      user?.role === Role.ADMIN || isOwnHotelModerator(user, hotelId);
    if (!hotel || (!hotel.isActive && !canSeeInactive)) {
      throw new NotFoundException('Hotel not found');
    }
    const { checkIn, checkOut } = this.validateStay(dates, now);

    const rooms = await this.rooms.find({
      hotel: new Types.ObjectId(hotelId),
      isActive: true,
    });
    const taken = await this.queries.takenRoomIds(
      rooms.map((room) => room.id),
      checkIn,
      checkOut,
      now,
    );
    const nights = nightsOf(checkIn, checkOut).length;
    const free = freeRooms(rooms.map(toSearchRoom), taken, checkIn, checkOut);
    return {
      hotelId,
      checkIn: formatDate(checkIn),
      checkOut: formatDate(checkOut),
      nights,
      rooms: free
        .map((room): AvailableRoomView => ({
          id: room.id,
          name: room.name,
          type: room.type ?? null,
          beds: room.beds,
          maxOccupancy: room.maxOccupancy,
          pricePerNight: room.pricePerNight,
          totalPrice: roundMoney(room.pricePerNight * nights),
        }))
        .sort(
          (a, b) =>
            a.pricePerNight - b.pricePerNight || a.name.localeCompare(b.name),
        ),
    };
  }

  /** Every rule of HTL-11 that does not need the database; throws a 400 field error. */
  private validate(query: HotelSearchQuery, now: Date) {
    if (!query.city && !query.country) {
      throw fieldError('city', 'Send a city or a country to search in');
    }
    const stay = this.validateStay(query, now);
    if (query.rooms > query.guests) {
      throw fieldError('rooms', 'Every room needs at least one guest');
    }
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw fieldError('minPrice', 'The minimum price is above the maximum');
    }
    return stay;
  }

  /** Real dates, check-out after check-in, check-in not in the past (HTL-11). */
  private validateStay(
    dates: { checkIn: string; checkOut: string },
    now: Date,
  ): { checkIn: Date; checkOut: Date } {
    const checkIn = parseRealDay(dates.checkIn, 'checkIn');
    const checkOut = parseRealDay(dates.checkOut, 'checkOut');
    assertValidStay(checkIn, checkOut, now);
    return { checkIn, checkOut };
  }
}

function toSearchRoom(room: {
  id: string;
  name: string;
  type?: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  isActive: boolean;
  availability: { from: Date; to: Date }[];
  blocked: { from: Date; to: Date }[];
}): SearchRoom {
  return {
    id: room.id,
    name: room.name,
    ...(room.type ? { type: room.type } : {}),
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    pricePerNight: room.pricePerNight,
    isActive: room.isActive,
    availability: room.availability,
    blocked: room.blocked,
  };
}
