import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import { PLATFORM_CURRENCY } from '../../payments/platform-currency';
import { UsersService } from '../../users/users.service';
import { addDays, formatDate } from '../itinerary-dates';
import { ItineraryRepository } from '../itinerary.repository';
import type { ItineraryDocument } from '../schemas/itinerary.schema';
import { foreignCurrencies, summarize } from './budget-summary';
import type { BudgetBreakdown } from './budget-summary';
import { assertCurrencyCode, convert } from './fx/currency-math';
import type { RateTable } from './fx/currency-math';
import { FxService } from './fx/fx.service';
import { BudgetEntry } from './schemas/budget-entry.schema';
import { TransportCost } from './schemas/transport-cost.schema';

type Caller = Pick<AuthUser, 'id' | 'role'>;

export interface BudgetSummaryView extends BudgetBreakdown {
  /** The currency every amount below is shown in. */
  currency: string;
  /** Date of the exchange rates used; null when nothing needed converting. */
  rateDate: string | null;
  /** True when the rate provider was unavailable and cached rates were used. */
  ratesStale: boolean;
}

/** ITN-14 and ITN-18: the converted budget summary. */
@Injectable()
export class BudgetSummaryService {
  constructor(
    @InjectModel(BudgetEntry.name)
    private readonly entries: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transport: Model<TransportCost>,
    private readonly itineraries: ItineraryRepository,
    private readonly fx: FxService,
    private readonly users: UsersService,
  ) {}

  async summary(
    user: Caller,
    itineraryId: string,
    currency?: string,
  ): Promise<BudgetSummaryView> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    if (currency) assertCurrencyCode(currency);
    const target = currency ?? (await this.preferredCurrency(user.id));
    return this.compute(itinerary, target);
  }

  /**
   * Per-day totals in the owner's preferred currency for the itinerary's
   * city groups (the `ItineraryBudgets` hook).
   */
  async dayTotals(
    itineraryId: string,
    ownerId: string,
  ): Promise<{ currency: string; byDay: Record<string, number> }> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, {
      id: ownerId,
      role: Role.USER,
    });
    const target = await this.preferredCurrency(ownerId);
    const view = await this.compute(itinerary, target);
    return {
      currency: target,
      byDay: Object.fromEntries(
        view.byDay.map((day) => [day.dayId, day.total]),
      ),
    };
  }

  private async compute(
    itinerary: ItineraryDocument,
    target: string,
  ): Promise<BudgetSummaryView> {
    const filter = { itineraryId: itinerary._id };
    const [entries, transportCosts] = await Promise.all([
      this.entries.find(filter),
      this.transport.find(filter),
    ]);
    const input = {
      days: itinerary.days.map((day, index) => ({
        id: day._id.toString(),
        number: index + 1,
        date: formatDate(addDays(itinerary.startDate, index)),
        city: day.city,
        activities: day.activities,
      })),
      entries: entries.map((entry) => ({
        dayId: entry.dayId.toString(),
        category: entry.category,
        amount: entry.amount,
        currency: entry.currency,
      })),
      transportCosts: transportCosts.map((cost) => ({
        dayId: cost.dayId.toString(),
        amount: cost.amount,
        currency: cost.currency,
      })),
    };

    // Rates are only needed (and only fetched) when something is in another currency.
    let table: RateTable | null = null;
    if (foreignCurrencies(input, target).size > 0) {
      table = await this.fx.getRates();
    }
    const breakdown = summarize(input, (amount, from) =>
      table ? convert(amount, from, target, table) : amount,
    );

    return {
      currency: target,
      rateDate: table?.rateDate ?? null,
      ratesStale: table?.stale ?? false,
      ...breakdown,
    };
  }

  /** The user's preferred currency (ACC-09), or the platform currency before they pick one. */
  private async preferredCurrency(userId: string): Promise<string> {
    if (!Types.ObjectId.isValid(userId)) return PLATFORM_CURRENCY;
    const user = await this.users.findById(userId);
    return user?.preferredCurrency ?? PLATFORM_CURRENCY;
  }
}
