import { SortOrder } from '../../flights/dto/search-flights.dto';
import { roomBookable } from '../date-ranges';
import type { BookableRoom } from '../date-ranges';

export { SortOrder };

/** How hotel results can be ordered (HTL-12). */
export enum HotelSortBy {
  PRICE = 'price',
  RATING = 'rating',
}

/** A room as the search sees it: what it costs, holds and when it can be booked. */
export interface SearchRoom extends BookableRoom {
  id: string;
  name: string;
  type?: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
}

export interface HotelFilters {
  /** Inclusive, per night, of the cheapest free room. */
  minPrice?: number;
  maxPrice?: number;
  /** Minimum average rating; unrated hotels fail it (HTL-12). */
  minRating?: number;
}

/**
 * HTL-11: rooms free for the whole stay. A room counts only when it is active,
 * every night is inside its availability and not blocked (HTL-04, HTL-06), and
 * no Confirmed reservation or unexpired hold has taken it (`taken`).
 */
export function freeRooms<T extends SearchRoom>(
  rooms: T[],
  taken: Set<string>,
  checkIn: Date,
  checkOut: Date,
): T[] {
  return rooms.filter(
    (room) => !taken.has(room.id) && roomBookable(room, checkIn, checkOut),
  );
}

/**
 * HTL-11: at least `roomsWanted` rooms are free and the best of them, the
 * `roomsWanted` with the largest occupancy, can sleep all the guests together.
 */
export function canHost(
  free: Pick<SearchRoom, 'maxOccupancy'>[],
  roomsWanted: number,
  guests: number,
): boolean {
  if (free.length < roomsWanted) return false;
  const capacity = free
    .map((room) => room.maxOccupancy)
    .sort((a, b) => b - a)
    .slice(0, roomsWanted)
    .reduce((sum, occupancy) => sum + occupancy, 0);
  return capacity >= guests;
}

/** HTL-12: the hotel's price is the price per night of its cheapest free room. */
export function cheapestPrice(
  free: Pick<SearchRoom, 'pricePerNight'>[],
): number {
  return Math.min(...free.map((room) => room.pricePerNight));
}

/** HTL-12: inclusive price range and minimum rating; unrated fails a rating filter. */
export function matchesFilters(
  price: number,
  rating: number | null,
  filters: HotelFilters,
): boolean {
  if (filters.minPrice !== undefined && price < filters.minPrice) return false;
  if (filters.maxPrice !== undefined && price > filters.maxPrice) return false;
  if (filters.minRating !== undefined) {
    if (rating === null || rating < filters.minRating) return false;
  }
  return true;
}

interface Sortable {
  id: string;
  name: string;
  price: number;
  rating: number | null;
}

/**
 * HTL-12: orders by price or rating. Unrated hotels go last in either
 * direction; ties fall back to name then id so paging is stable.
 */
export function sortHotels<T extends Sortable>(
  items: T[],
  sortBy: HotelSortBy,
  order: SortOrder,
): T[] {
  const direction = order === SortOrder.DESC ? -1 : 1;
  return [...items].sort((a, b) => {
    let primary = 0;
    if (sortBy === HotelSortBy.PRICE) {
      primary = (a.price - b.price) * direction;
    } else if (a.rating === null || b.rating === null) {
      if (a.rating !== b.rating) return a.rating === null ? 1 : -1;
    } else {
      primary = (a.rating - b.rating) * direction;
    }
    if (primary !== 0) return primary;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
