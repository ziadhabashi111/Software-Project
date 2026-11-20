import { Visibility } from './schemas/itinerary.schema';

/** What a visitor can filter public itineraries by (ITN-21). */
export interface PublicSearchFilters {
  q?: string;
  country?: string;
  city?: string;
  minDays?: number;
  maxDays?: number;
}

/** Countries and cities the keyword names (from the reference data). */
export interface KeywordMatches {
  countryCodes: string[];
  cityIds: string[];
}

export interface PublicSearchMatch {
  visibility: Visibility.PUBLIC;
  isHidden: false;
  countries?: string;
  'days.city'?: string;
  $and?: { $or: Record<string, unknown>[] }[];
  $expr?: { $and: Record<string, unknown>[] };
}

export const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ITN-21: the `$match` for the public search. Only public itineraries that a
 * moderator has not hidden are ever matched; whose owner is still active is
 * checked separately, in the pipeline. The keyword matches the title, or any
 * country or city it names; the filters narrow further; the duration is the
 * number of days, inclusive.
 */
export function buildPublicSearchMatch(
  filters: PublicSearchFilters,
  keyword: KeywordMatches,
): PublicSearchMatch {
  const match: PublicSearchMatch = {
    visibility: Visibility.PUBLIC,
    isHidden: false,
  };

  if (filters.q) {
    const or: Record<string, unknown>[] = [
      { title: new RegExp(escapeRegex(filters.q), 'i') },
    ];
    if (keyword.countryCodes.length > 0) {
      or.push({ countries: { $in: keyword.countryCodes } });
    }
    if (keyword.cityIds.length > 0) {
      or.push({ 'days.city': { $in: keyword.cityIds } });
    }
    match.$and = [{ $or: or }];
  }
  if (filters.country) match.countries = filters.country.toUpperCase();
  if (filters.city) match['days.city'] = filters.city.toLowerCase();

  const days: Record<string, unknown>[] = [];
  if (filters.minDays !== undefined) {
    days.push({ $gte: [{ $size: '$days' }, filters.minDays] });
  }
  if (filters.maxDays !== undefined) {
    days.push({ $lte: [{ $size: '$days' }, filters.maxDays] });
  }
  if (days.length > 0) match.$expr = { $and: days };

  return match;
}
