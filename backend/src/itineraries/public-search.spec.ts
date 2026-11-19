import { buildPublicSearchMatch, escapeRegex } from './public-search';

const none = { countryCodes: [], cityIds: [] };

describe('public itinerary search filter (ITN-21)', () => {
  it('only ever matches public, not hidden itineraries', () => {
    expect(buildPublicSearchMatch({}, none)).toMatchObject({
      visibility: 'public',
      isHidden: false,
    });
  });

  it('matches the keyword in the title, or the countries/cities it names', () => {
    const match = buildPublicSearchMatch(
      { q: 'egypt' },
      { countryCodes: ['EG'], cityIds: ['cairo', 'luxor'] },
    );
    const or = match.$and?.[0].$or as Record<string, unknown>[];
    expect(or).toEqual([
      { title: expect.any(RegExp) as RegExp },
      { countries: { $in: ['EG'] } },
      { 'days.city': { $in: ['cairo', 'luxor'] } },
    ]);
    expect((or[0].title as RegExp).test('A week in EGYPT')).toBe(true);
    expect((or[0].title as RegExp).test('Italy')).toBe(false);
  });

  it('escapes regular-expression characters typed in the keyword', () => {
    expect(escapeRegex('a.b*c(')).toBe('a\\.b\\*c\\(');
    const match = buildPublicSearchMatch({ q: '.*' }, none);
    const title = (match.$and?.[0].$or as { title: RegExp }[])[0].title;
    expect(title.test('anything')).toBe(false);
    expect(title.test('a.* sign')).toBe(true);
  });

  it('filters by country and by city', () => {
    const match = buildPublicSearchMatch(
      { country: 'eg', city: 'Cairo' },
      none,
    );
    expect(match.countries).toBe('EG');
    expect(match['days.city']).toBe('cairo');
  });

  it('filters by duration in days, inclusive', () => {
    const match = buildPublicSearchMatch({ minDays: 3, maxDays: 7 }, none);
    expect(match.$expr).toEqual({
      $and: [
        { $gte: [{ $size: '$days' }, 3] },
        { $lte: [{ $size: '$days' }, 7] },
      ],
    });
  });

  it('adds only the duration bounds that were given', () => {
    expect(buildPublicSearchMatch({ minDays: 2 }, none).$expr).toEqual({
      $and: [{ $gte: [{ $size: '$days' }, 2] }],
    });
    expect(buildPublicSearchMatch({}, none).$expr).toBeUndefined();
  });
});
