import { addDays, buildGroups, formatDate, parseDate } from './itinerary-dates';

describe('itinerary dates (ITN-05, ITN-07, ITN-08)', () => {
  it('parses a plain date as midnight UTC and formats it back', () => {
    const date = parseDate('2027-03-01');
    expect(date.toISOString()).toBe('2027-03-01T00:00:00.000Z');
    expect(formatDate(date)).toBe('2027-03-01');
  });

  it('adds days across a month boundary and in a leap year', () => {
    expect(formatDate(addDays(parseDate('2027-01-30'), 3))).toBe('2027-02-02');
    expect(formatDate(addDays(parseDate('2028-02-28'), 2))).toBe('2028-03-01');
    expect(formatDate(addDays(parseDate('2027-02-28'), 1))).toBe('2027-03-01');
  });

  it('does not move when adding zero days', () => {
    expect(formatDate(addDays(parseDate('2027-06-15'), 0))).toBe('2027-06-15');
  });
});

describe('city groups (ITN-09)', () => {
  const start = parseDate('2027-03-01');

  it('returns no groups for no days', () => {
    expect(buildGroups([], start)).toEqual([]);
  });

  it('groups consecutive days in the same city with day count and dates', () => {
    const groups = buildGroups(
      [
        { id: 'a', city: 'cairo' },
        { id: 'b', city: 'cairo' },
        { id: 'c', city: 'dubai' },
      ],
      start,
    );
    expect(groups).toEqual([
      {
        city: 'cairo',
        startDay: 1,
        endDay: 2,
        dayCount: 2,
        startDate: '2027-03-01',
        endDate: '2027-03-02',
        dayIds: ['a', 'b'],
      },
      {
        city: 'dubai',
        startDay: 3,
        endDay: 3,
        dayCount: 1,
        startDate: '2027-03-03',
        endDate: '2027-03-03',
        dayIds: ['c'],
      },
    ]);
  });

  it('keeps a city that comes back later as a separate group', () => {
    const groups = buildGroups(
      [
        { id: 'a', city: 'cairo' },
        { id: 'b', city: 'dubai' },
        { id: 'c', city: 'cairo' },
      ],
      start,
    );
    expect(groups.map((g) => [g.city, g.dayCount])).toEqual([
      ['cairo', 1],
      ['dubai', 1],
      ['cairo', 1],
    ]);
  });
});
