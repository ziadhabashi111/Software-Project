import { Injectable } from '@nestjs/common';

/**
 * Implemented by the budget module (Youssef: budget entries, transport costs
 * and exchange rates, ITN-14, 16, 18) and registered once in
 * `ItineraryBudgets`. The itinerary module owns the days; this hook lets the
 * budget side give each city group its subtotal and clean up after deletes.
 */
export interface ItineraryBudgetProvider {
  /**
   * The total budget of each day in the owner's preferred currency, keyed by
   * day id. Days without any budget may be missing (they count as zero).
   */
  dayTotals(
    itineraryId: string,
    ownerId: string,
  ): Promise<{ currency: string; byDay: Record<string, number> }>;
  /** A day was deleted: remove its budget entries and transport costs (ITN-07). */
  removeDay(itineraryId: string, dayId: string): Promise<void>;
  /** The itinerary was deleted: remove everything that belongs to it. */
  removeItinerary(itineraryId: string): Promise<void>;
}

@Injectable()
export class ItineraryBudgets {
  private provider?: ItineraryBudgetProvider;

  register(provider: ItineraryBudgetProvider): void {
    this.provider = provider;
  }

  get(): ItineraryBudgetProvider | undefined {
    return this.provider;
  }
}
