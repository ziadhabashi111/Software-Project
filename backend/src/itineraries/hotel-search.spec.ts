import { BadRequestException } from '@nestjs/common';
import { buildGroups, parseDate } from './itinerary-dates';
import { hotelCriteriaFor } from './hotel-search';

const groups = buildGroups(
  [
    { id: 'd1', city: 'cairo' },
    { id: 'd2', city: 'cairo' },
    { id: 'd3', city: 'luxor' },
    { id: 'd4', city: 'cairo' },
  ],
  parseDate('2027-03-01'),
);

describe('hotels for a city group (ITN-25)', () => {
  it('checks in on the first day of the group and out the day after its last', () => {
    expect(hotelCriteriaFor(groups, 1, { guests: 2, rooms: 1 })).toEqual({
      city: 'cairo',
      checkIn: '2027-03-01',
      checkOut: '2027-03-03',
      guests: 2,
      rooms: 1,
    });
  });

  it('a one-day group stays one night', () => {
    expect(hotelCriteriaFor(groups, 2, { guests: 1, rooms: 1 })).toMatchObject({
      city: 'luxor',
      checkIn: '2027-03-03',
      checkOut: '2027-03-04',
    });
  });

  it('picks groups by their position, 1-based, and rejects one that does not exist', () => {
    expect(hotelCriteriaFor(groups, 3, { guests: 1, rooms: 1 }).checkIn).toBe(
      '2027-03-04',
    );
    expect(() => hotelCriteriaFor(groups, 4, { guests: 1, rooms: 1 })).toThrow(
      BadRequestException,
    );
    expect(() => hotelCriteriaFor(groups, 0, { guests: 1, rooms: 1 })).toThrow(
      BadRequestException,
    );
  });

  it('needs at least one guest per room', () => {
    expect(() => hotelCriteriaFor(groups, 1, { guests: 1, rooms: 2 })).toThrow(
      BadRequestException,
    );
    expect(() =>
      hotelCriteriaFor(groups, 1, { guests: 2, rooms: 2 }),
    ).not.toThrow();
  });

  it('answers 400 for an itinerary without days', () => {
    expect(() => hotelCriteriaFor([], 1, { guests: 1, rooms: 1 })).toThrow(
      BadRequestException,
    );
  });
});
