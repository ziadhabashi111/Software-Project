import { PLATFORM_CURRENCY } from '../../payments/platform-currency';
import { BudgetCategory } from './budget-categories';
import { round2 } from './fx/currency-math';

/** ITN-14: transport between cities is its own line in the breakdown. */
export const INTERCITY_TRANSPORT = 'intercity_transport';
export type SummaryCategory = BudgetCategory | typeof INTERCITY_TRANSPORT;

export const SUMMARY_CATEGORIES: SummaryCategory[] = [
  BudgetCategory.FOOD,
  BudgetCategory.ACCOMMODATION,
  BudgetCategory.IN_CITY_TRANSPORT,
  BudgetCategory.ACTIVITIES,
  INTERCITY_TRANSPORT,
];

export interface SummaryDay {
  id: string;
  number: number;
  date: string;
  city: string;
  /** Activity costs count under Activities (ITN-10, ITN-14). */
  activities: { cost?: number | null; currency?: string | null }[];
}

export interface SummaryInput {
  days: SummaryDay[];
  entries: {
    dayId: string;
    category: BudgetCategory;
    amount: number;
    currency: string;
  }[];
  transportCosts: { dayId: string; amount: number; currency: string }[];
}

export type CategoryAmounts = Record<SummaryCategory, number>;

export interface DayBreakdown extends CategoryAmounts {
  dayId: string;
  number: number;
  date: string;
  city: string;
  total: number;
}

export interface BudgetBreakdown {
  totals: CategoryAmounts & { total: number };
  byDay: DayBreakdown[];
}

const emptyAmounts = (): CategoryAmounts => ({
  [BudgetCategory.FOOD]: 0,
  [BudgetCategory.ACCOMMODATION]: 0,
  [BudgetCategory.IN_CITY_TRANSPORT]: 0,
  [BudgetCategory.ACTIVITIES]: 0,
  [INTERCITY_TRANSPORT]: 0,
});

/**
 * The currency of an activity cost. New costs always carry one; a cost stored
 * before that rule has none and is taken to be in the platform currency, never
 * in the viewer's display currency (which would change its value per viewer).
 */
export const activityCurrency = (activity: {
  currency?: string | null;
}): string => activity.currency || PLATFORM_CURRENCY;

/** The currencies that must be converted into `target` (empty means no rates are needed). */
export function foreignCurrencies(
  input: SummaryInput,
  target: string,
): Set<string> {
  const found = new Set<string>();
  const add = (currency?: string | null) => {
    if (currency && currency !== target) found.add(currency);
  };
  input.entries.forEach((entry) => add(entry.currency));
  input.transportCosts.forEach((cost) => add(cost.currency));
  input.days.forEach((day) =>
    day.activities.forEach((activity) => {
      if (activity.cost) add(activityCurrency(activity));
    }),
  );
  return found;
}

/**
 * ITN-14: the total budget by category and by day. Totals include budget
 * entries, activity costs (under Activities) and intercity transport entries.
 * Everything is converted into the target currency with `convert` (ITN-18);
 * a legacy activity cost with no currency is taken to be in the platform
 * currency (see `activityCurrency`).
 * Entries of a day that no longer exists are ignored. Booking prices are not
 * part of the budget and are never converted (PAY-04).
 */
export function summarize(
  input: SummaryInput,
  convert: (amount: number, from: string) => number,
): BudgetBreakdown {
  const perDay = new Map<string, CategoryAmounts>();
  for (const day of input.days) perDay.set(day.id, emptyAmounts());

  const add = (dayId: string, category: SummaryCategory, value: number) => {
    const amounts = perDay.get(dayId);
    if (amounts) amounts[category] += value;
  };

  for (const entry of input.entries) {
    add(entry.dayId, entry.category, convert(entry.amount, entry.currency));
  }
  for (const cost of input.transportCosts) {
    add(cost.dayId, INTERCITY_TRANSPORT, convert(cost.amount, cost.currency));
  }
  for (const day of input.days) {
    for (const activity of day.activities) {
      if (!activity.cost) continue;
      add(
        day.id,
        BudgetCategory.ACTIVITIES,
        convert(activity.cost, activityCurrency(activity)),
      );
    }
  }

  const totals = emptyAmounts();
  const byDay = input.days.map((day): DayBreakdown => {
    const amounts = perDay.get(day.id) ?? emptyAmounts();
    let dayTotal = 0;
    for (const category of SUMMARY_CATEGORIES) {
      totals[category] += amounts[category];
      dayTotal += amounts[category];
    }
    return {
      dayId: day.id,
      number: day.number,
      date: day.date,
      city: day.city,
      ...roundAll(amounts),
      total: round2(dayTotal),
    };
  });

  const grand = SUMMARY_CATEGORIES.reduce((sum, c) => sum + totals[c], 0);
  return { totals: { ...roundAll(totals), total: round2(grand) }, byDay };
}

function roundAll(amounts: CategoryAmounts): CategoryAmounts {
  const rounded = emptyAmounts();
  for (const category of SUMMARY_CATEGORIES) {
    rounded[category] = round2(amounts[category]);
  }
  return rounded;
}
