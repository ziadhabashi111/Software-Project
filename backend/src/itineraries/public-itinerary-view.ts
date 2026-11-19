import type { BudgetSummaryView } from './budget/budget-summary.service';
import { formatDate } from './itinerary-dates';
import type { ItineraryView } from './itinerary-view';
import type { ItineraryDocument } from './schemas/itinerary.schema';

export interface PublicAuthor {
  id: string;
  name: string;
}

/** One row of the public search (ITN-21). */
export interface PublicItineraryListItem {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  dayCount: number;
  author: PublicAuthor;
  updatedAt: Date;
}

/** A public itinerary, read-only (ITN-21): no visibility or moderation fields. */
export type PublicItineraryView = Omit<
  ItineraryView,
  'isHidden' | 'visibility'
> & {
  author: PublicAuthor;
  /** The budget in the asked currency; null when the budget module could not answer. */
  budget: BudgetSummaryView | null;
};

export function toPublicListItem(
  itinerary: ItineraryDocument,
  author: PublicAuthor,
): PublicItineraryListItem {
  return {
    id: itinerary.id,
    title: itinerary.title,
    countries: itinerary.countries,
    startDate: formatDate(itinerary.startDate),
    dayCount: itinerary.days.length,
    author,
    updatedAt: itinerary.updatedAt,
  };
}
