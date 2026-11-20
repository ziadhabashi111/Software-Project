import { SortOrder } from '../../flights/dto/search-flights.dto';
import {
  canHost,
  cheapestPrice,
  freeRooms,
  HotelSortBy,
  matchesFilters,
  sortHotels,
} from './hotel-search-rules';
import type { SearchRoom } from './hotel-search-rules';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function room(id: string, overrides: Partial<SearchRoom> = {}): SearchRoom {
  return {
    id,
    name: `Room ${id}`,
    beds: 1,
    maxOccupancy: 2,
    pricePerNight: 100,
    isActive: true,
    availability: [{ from: day('2027-03-01'), to: day('2027-03-31') }],
    blocked: [],
    ...overrides,
  };
}

const IN = day('2027-03-10');
const OUT = day('2027-03-13'); // nights 10, 11, 12

describe('freeRooms (HTL-11)', () => {
  it('keeps rooms that are bookable for every night and not taken', () => {
    const free = freeRooms([room('a'), room('b')], new Set(), IN, OUT);
    expect(free.map((r) => r.id)).toEqual(['a', 'b']);
  });

  // A reservation or an unexpired hold on any night makes the whole room unfree.
  it('drops a room that a reservation or hold has taken', () => {
    const free = freeRooms([room('a'), room('b')], new Set(['a']), IN, OUT);
    expect(free.map((r) => r.id)).toEqual(['b']);
  });

  it('drops deactivated rooms, blocked nights and nights outside availability', () => {
    const rooms = [
      room('off', { isActive: false }),
      room('blocked', {
        blocked: [{ from: day('2027-03-11'), to: day('2027-03-11') }],
      }),
      room('short', {
        availability: [{ from: day('2027-03-01'), to: day('2027-03-11') }],
      }),
      room('ok'),
    ];
    expect(freeRooms(rooms, new Set(), IN, OUT).map((r) => r.id)).toEqual([
      'ok',
    ]);
  });

  // The check-out day is not a night, so a block on it must not matter.
  it('ignores a block on the check-out day itself', () => {
    const r = room('a', {
      blocked: [{ from: day('2027-03-13'), to: day('2027-03-13') }],
    });
    expect(freeRooms([r], new Set(), IN, OUT)).toHaveLength(1);
  });

  it('is empty for no rooms', () => {
    expect(freeRooms([], new Set(), IN, OUT)).toEqual([]);
  });
});

describe('canHost (HTL-11)', () => {
  const free = [
    room('a', { maxOccupancy: 2 }),
    room('b', { maxOccupancy: 4 }),
    room('c', { maxOccupancy: 3 }),
  ];

  it('needs at least as many free rooms as requested', () => {
    expect(canHost(free, 4, 4)).toBe(false);
    expect(canHost(free, 3, 3)).toBe(true);
  });

  // The best N rooms are used: 4 + 3 = 7 covers 7 guests in two rooms.
  it('adds the largest occupancies of the requested number of rooms', () => {
    expect(canHost(free, 2, 7)).toBe(true);
    expect(canHost(free, 2, 8)).toBe(false);
  });

  it('is false when there are no free rooms', () => {
    expect(canHost([], 1, 1)).toBe(false);
  });

  // Boundary: occupancy exactly equal to the guests is enough.
  it('accepts a combined occupancy exactly equal to the guests', () => {
    expect(canHost([room('a', { maxOccupancy: 2 })], 1, 2)).toBe(true);
    expect(canHost([room('a', { maxOccupancy: 2 })], 1, 3)).toBe(false);
  });
});

describe('cheapestPrice (HTL-12)', () => {
  it('is the lowest price per night of the free rooms', () => {
    const rooms = [
      room('a', { pricePerNight: 150 }),
      room('b', { pricePerNight: 80.5 }),
    ];
    expect(cheapestPrice(rooms)).toBe(80.5);
  });
});

describe('matchesFilters (HTL-12)', () => {
  it('has no limits when no filter is set, even for an unrated hotel', () => {
    expect(matchesFilters(100, null, {})).toBe(true);
  });

  // Both ends are inclusive.
  it('includes hotels priced exactly at the minimum or maximum', () => {
    expect(matchesFilters(100, 4, { minPrice: 100, maxPrice: 100 })).toBe(true);
    expect(matchesFilters(99.99, 4, { minPrice: 100 })).toBe(false);
    expect(matchesFilters(100.01, 4, { maxPrice: 100 })).toBe(false);
  });

  it('filters by minimum average rating, inclusively', () => {
    expect(matchesFilters(100, 4, { minRating: 4 })).toBe(true);
    expect(matchesFilters(100, 3.9, { minRating: 4 })).toBe(false);
  });

  // HTL-12: unrated hotels are excluded only when a rating filter is set.
  it('excludes an unrated hotel only when a minimum rating is set', () => {
    expect(matchesFilters(100, null, { minRating: 1 })).toBe(false);
    expect(matchesFilters(100, null, { minPrice: 50 })).toBe(true);
  });
});

describe('sortHotels (HTL-12)', () => {
  const rows = [
    { id: '1', name: 'B', price: 120, rating: 4.0 },
    { id: '2', name: 'A', price: 90, rating: null },
    { id: '3', name: 'C', price: 120, rating: 4.8 },
  ];

  it('sorts by price ascending with the name as a stable tie-break', () => {
    const sorted = sortHotels(rows, HotelSortBy.PRICE, SortOrder.ASC);
    expect(sorted.map((r) => r.id)).toEqual(['2', '1', '3']);
  });

  it('sorts by price descending', () => {
    const sorted = sortHotels(rows, HotelSortBy.PRICE, SortOrder.DESC);
    expect(sorted.map((r) => r.price)).toEqual([120, 120, 90]);
  });

  // Unrated hotels go last whichever way the ratings are ordered.
  it('sorts by rating and keeps unrated hotels last in both directions', () => {
    const best = sortHotels(rows, HotelSortBy.RATING, SortOrder.DESC);
    expect(best.map((r) => r.id)).toEqual(['3', '1', '2']);
    const worst = sortHotels(rows, HotelSortBy.RATING, SortOrder.ASC);
    expect(worst.map((r) => r.id)).toEqual(['1', '3', '2']);
  });

  it('does not change the input array', () => {
    const copy = [...rows];
    sortHotels(rows, HotelSortBy.PRICE, SortOrder.DESC);
    expect(rows).toEqual(copy);
  });

  it('handles an empty list', () => {
    expect(sortHotels([], HotelSortBy.PRICE, SortOrder.ASC)).toEqual([]);
  });
});
