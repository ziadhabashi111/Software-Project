import type { BudgetCategory, TransportMode } from './budget-categories';
import type { BudgetEntryDocument } from './schemas/budget-entry.schema';
import type { TransportCostDocument } from './schemas/transport-cost.schema';

export interface BudgetEntryView {
  id: string;
  itineraryId: string;
  dayId: string;
  category: BudgetCategory;
  amount: number;
  currency: string;
  note?: string;
}

export interface TransportCostView {
  id: string;
  itineraryId: string;
  dayId: string;
  mode: TransportMode;
  fromCity: string;
  toCity: string;
  amount: number;
  currency: string;
}

export interface BudgetListView {
  entries: BudgetEntryView[];
  transportCosts: TransportCostView[];
}

export function toBudgetEntryView(entry: BudgetEntryDocument): BudgetEntryView {
  return {
    id: entry.id,
    itineraryId: entry.itineraryId.toString(),
    dayId: entry.dayId.toString(),
    category: entry.category,
    amount: entry.amount,
    currency: entry.currency,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

export function toTransportCostView(
  cost: TransportCostDocument,
): TransportCostView {
  return {
    id: cost.id,
    itineraryId: cost.itineraryId.toString(),
    dayId: cost.dayId.toString(),
    mode: cost.mode,
    fromCity: cost.fromCity,
    toCity: cost.toCity,
    amount: cost.amount,
    currency: cost.currency,
  };
}
