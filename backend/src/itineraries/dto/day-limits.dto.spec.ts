import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MAX_DAYS } from '../itinerary-limits';
import { ItineraryHotelsQueryDto } from './itinerary-hotels-query.dto';
import { PublicSearchQueryDto } from './public-search-query.dto';

type DtoClass = new () => object;

function invalid(cls: DtoClass, query: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, query)).map((e) => e.property);
}

/** Day counts in queries follow the one itinerary day limit (ITN-05, ITN-21, ITN-25). */
describe('day limits in queries use MAX_DAYS', () => {
  it.each([
    [PublicSearchQueryDto, 'minDays'],
    [PublicSearchQueryDto, 'maxDays'],
    [ItineraryHotelsQueryDto, 'group'],
  ] as [DtoClass, string][])(
    '%p.%s accepts MAX_DAYS, not more',
    (cls, field) => {
      expect(invalid(cls, { [field]: String(MAX_DAYS) })).toEqual([]);
      expect(invalid(cls, { [field]: String(MAX_DAYS + 1) })).toEqual([field]);
    },
  );
});
