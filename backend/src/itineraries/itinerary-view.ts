import { addDays, buildGroups, CityGroup, formatDate } from './itinerary-dates';
import type {
  Activity,
  ItineraryDocument,
  Visibility,
} from './schemas/itinerary.schema';

export interface ActivityView {
  id: string;
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
  images: { id: string; url: string }[];
}

export interface DayView {
  id: string;
  number: number;
  date: string;
  city: string;
  notes?: string;
  activities: ActivityView[];
}

export interface GroupView extends CityGroup {
  /** In the owner's preferred currency; null until the budget module answers. */
  subtotal: { amount: number; currency: string } | null;
}

export interface ItineraryView {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  visibility: Visibility;
  isHidden: boolean;
  days: DayView[];
  groups: GroupView[];
  /** Only on a clone: the original author is credited (ITN-21). */
  clonedFrom?: { itineraryId: string; authorId: string; authorName: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface ItinerarySummary {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  dayCount: number;
  visibility: Visibility;
  updatedAt: Date;
}

/** What the budget module reported for each day, if it answered. */
export interface DayBudgets {
  currency: string;
  byDay: Record<string, number>;
}

export function toActivityView(activity: Activity): ActivityView {
  return {
    id: activity._id.toString(),
    name: activity.name,
    ...(activity.description ? { description: activity.description } : {}),
    ...(activity.time ? { time: activity.time } : {}),
    ...(activity.cost !== undefined && activity.cost !== null
      ? { cost: activity.cost }
      : {}),
    ...(activity.currency ? { currency: activity.currency } : {}),
    images: activity.images.map((image) => ({
      id: image._id.toString(),
      url: image.url,
    })),
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Days are numbered and dated from their position and the start date (ITN-05). */
export function toItineraryView(
  itinerary: ItineraryDocument,
  budgets: DayBudgets | null,
): ItineraryView {
  const days: DayView[] = itinerary.days.map((day, index) => ({
    id: day._id.toString(),
    number: index + 1,
    date: formatDate(addDays(itinerary.startDate, index)),
    city: day.city,
    ...(day.notes ? { notes: day.notes } : {}),
    activities: day.activities.map(toActivityView),
  }));

  const groups: GroupView[] = buildGroups(
    days.map((day) => ({ id: day.id, city: day.city })),
    itinerary.startDate,
  ).map((group) => ({
    ...group,
    subtotal: budgets
      ? {
          amount: round2(
            group.dayIds.reduce((sum, id) => sum + (budgets.byDay[id] ?? 0), 0),
          ),
          currency: budgets.currency,
        }
      : null,
  }));

  return {
    id: itinerary.id,
    title: itinerary.title,
    countries: itinerary.countries,
    startDate: formatDate(itinerary.startDate),
    visibility: itinerary.visibility,
    isHidden: itinerary.isHidden,
    days,
    groups,
    ...(itinerary.clonedFrom
      ? {
          clonedFrom: {
            itineraryId: itinerary.clonedFrom.itinerary.toString(),
            authorId: itinerary.clonedFrom.author.toString(),
            authorName: itinerary.clonedFrom.authorName,
          },
        }
      : {}),
    createdAt: itinerary.createdAt,
    updatedAt: itinerary.updatedAt,
  };
}

export function toSummary(itinerary: ItineraryDocument): ItinerarySummary {
  return {
    id: itinerary.id,
    title: itinerary.title,
    countries: itinerary.countries,
    startDate: formatDate(itinerary.startDate),
    dayCount: itinerary.days.length,
    visibility: itinerary.visibility,
    updatedAt: itinerary.updatedAt,
  };
}
