import { Injectable, OnModuleInit } from '@nestjs/common';
import { ItineraryBudgets } from '../itinerary-budgets';
import type { ItineraryBudgetProvider } from '../itinerary-budgets';
import { BudgetSummaryService } from './budget-summary.service';
import { BudgetService } from './budget.service';

/**
 * Registers the budget side with the itinerary module's `ItineraryBudgets`
 * hook, so city groups get their subtotals and deleted days or itineraries
 * take their budget entries with them (ITN-07, ITN-09).
 */
@Injectable()
export class BudgetProvider implements OnModuleInit, ItineraryBudgetProvider {
  constructor(
    private readonly hook: ItineraryBudgets,
    private readonly budget: BudgetService,
    private readonly summary: BudgetSummaryService,
  ) {}

  onModuleInit(): void {
    this.hook.register(this);
  }

  dayTotals(
    itineraryId: string,
    ownerId: string,
  ): Promise<{ currency: string; byDay: Record<string, number> }> {
    return this.summary.dayTotals(itineraryId, ownerId);
  }

  removeDay(itineraryId: string, dayId: string): Promise<void> {
    return this.budget.removeDay(itineraryId, dayId);
  }

  removeItinerary(itineraryId: string): Promise<void> {
    return this.budget.removeItinerary(itineraryId);
  }
}
