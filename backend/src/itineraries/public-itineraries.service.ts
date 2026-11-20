import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AuthorItineraries } from '../blog/author-itineraries';
import type {
  AuthorItinerarySource,
  LinkedItinerary,
  PublicItinerarySummary,
} from '../blog/author-itineraries';
import { skipFor, toPage } from '../common/pagination/pagination';
import type { Paginated } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import type { BudgetSummaryView } from './budget/budget-summary.service';
import type { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { formatDate } from './itinerary-dates';
import { ItineraryBudgets } from './itinerary-budgets';
import type { ItineraryBudgetProvider } from './itinerary-budgets';
import { ItineraryRepository } from './itinerary.repository';
import { toItineraryView } from './itinerary-view';
import type { DayBudgets } from './itinerary-view';
import { PlaceCatalog } from './places';
import { toPublicListItem } from './public-itinerary-view';
import type {
  PublicAuthor,
  PublicItineraryListItem,
  PublicItineraryView,
} from './public-itinerary-view';
import { buildPublicSearchMatch } from './public-search';
import type { KeywordMatches } from './public-search';
import { Visibility } from './schemas/itinerary.schema';
import type { ItineraryDocument } from './schemas/itinerary.schema';

const COUNTRY_LIKE = /^[a-z]{2}$/i;

const summaryOf = (itinerary: ItineraryDocument): PublicItinerarySummary => ({
  id: itinerary.id,
  title: itinerary.title,
  countries: itinerary.countries,
  startDate: formatDate(itinerary.startDate),
  dayCount: itinerary.days.length,
});
const CITY_LIKE = /^[a-z0-9][a-z0-9_-]{0,59}$/;

/**
 * ITN-21: public itineraries for everyone, including visitors who are not
 * signed in. Only a public itinerary that a moderator has not hidden and
 * whose owner is not deactivated is ever shown; anything else answers 404,
 * so a private itinerary's existence is never revealed. Also the source of
 * an author's public itineraries for the blog's author page (BLG-12).
 */
@Injectable()
export class PublicItinerariesService
  implements OnModuleInit, AuthorItinerarySource
{
  private readonly logger = new Logger(PublicItinerariesService.name);

  constructor(
    private readonly repository: ItineraryRepository,
    private readonly places: PlaceCatalog,
    private readonly budgets: ItineraryBudgets,
    private readonly users: UsersService,
    private readonly authors: AuthorItineraries,
  ) {}

  onModuleInit(): void {
    this.authors.register(this);
  }

  async search(
    query: PublicSearchQueryDto,
  ): Promise<Paginated<PublicItineraryListItem>> {
    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    ) {
      throw fieldError(
        'minDays',
        'The fewest days cannot be above the most days',
      );
    }
    const match = buildPublicSearchMatch(
      query,
      await this.keywordMatches(query.q),
    );
    const { items, total } = await this.repository.searchPublic(match, {
      skip: skipFor(query),
      limit: query.limit,
    });
    const authors = await this.authorsOf(items);
    return toPage(
      items.map((itinerary) =>
        toPublicListItem(
          itinerary,
          authors.get(itinerary.owner.toString()) ?? {
            id: itinerary.owner.toString(),
            name: 'Traveller',
          },
        ),
      ),
      total,
      query,
    );
  }

  async get(id: string, currency?: string): Promise<PublicItineraryView> {
    const itinerary = await this.repository.findById(id);
    const author = itinerary ? await this.publicAuthor(itinerary) : null;
    if (!itinerary || !author)
      throw new NotFoundException('Itinerary not found');

    const provider = this.budgets.get();
    const [dayBudgets, budget] = await Promise.all([
      this.dayBudgets(provider, itinerary),
      this.budgetOf(provider, itinerary.id, currency),
    ]);
    const view = toItineraryView(itinerary, dayBudgets);
    // Read-only: no visibility or moderation fields.
    return {
      id: view.id,
      title: view.title,
      countries: view.countries,
      startDate: view.startDate,
      days: view.days,
      groups: view.groups,
      ...(view.clonedFrom ? { clonedFrom: view.clonedFrom } : {}),
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      author,
      budget,
    };
  }

  /** BLG-12: one author's public itineraries, newest first. */
  async publicForAuthor(
    authorId: string,
    page: { skip: number; limit: number },
  ): Promise<{ items: PublicItinerarySummary[]; total: number }> {
    const { items, total } = await this.repository.publicForAuthor(
      authorId,
      page,
    );
    return { items: items.map(summaryOf), total };
  }

  /**
   * BLG-13: the author's own itinerary, public or not. Someone else's
   * itinerary answers null, exactly like one that does not exist.
   */
  async ownedBy(
    authorId: string,
    itineraryId: string,
  ): Promise<LinkedItinerary | null> {
    const itinerary = await this.repository.findById(itineraryId);
    if (!itinerary || itinerary.owner.toString() !== authorId) return null;
    return {
      ...summaryOf(itinerary),
      isPublic:
        itinerary.visibility === Visibility.PUBLIC && !itinerary.isHidden,
    };
  }

  /**
   * BLG-13: what a reader of a post sees of the itinerary it links to, only
   * while the itinerary is public, not hidden and its owner active (the same
   * rule as the public itinerary page). Null otherwise.
   */
  async publicSummary(
    itineraryId: string,
  ): Promise<PublicItinerarySummary | null> {
    const itinerary = await this.repository.findById(itineraryId);
    if (!itinerary || !(await this.publicAuthor(itinerary))) return null;
    return summaryOf(itinerary);
  }

  /** Countries and cities the keyword names, plus the keyword read as a code or id. */
  private async keywordMatches(keyword?: string): Promise<KeywordMatches> {
    if (!keyword) return { countryCodes: [], cityIds: [] };
    const named = (await this.places.get()?.matchKeyword?.(keyword)) ?? {
      countryCodes: [],
      cityIds: [],
    };
    const countryCodes = new Set(named.countryCodes);
    const cityIds = new Set(named.cityIds);
    if (COUNTRY_LIKE.test(keyword)) countryCodes.add(keyword.toUpperCase());
    if (CITY_LIKE.test(keyword.toLowerCase()))
      cityIds.add(keyword.toLowerCase());
    return { countryCodes: [...countryCodes], cityIds: [...cityIds] };
  }

  /** The author, only when this itinerary may be shown to everyone. */
  private async publicAuthor(
    itinerary: ItineraryDocument,
  ): Promise<PublicAuthor | null> {
    if (itinerary.visibility !== Visibility.PUBLIC || itinerary.isHidden) {
      return null;
    }
    const owner = await this.users.findById(itinerary.owner.toString());
    if (!owner || owner.status === UserStatus.DEACTIVATED) return null;
    return { id: owner.id, name: owner.name };
  }

  private async authorsOf(
    itineraries: ItineraryDocument[],
  ): Promise<Map<string, PublicAuthor>> {
    const ids = [...new Set(itineraries.map((i) => i.owner.toString()))];
    const owners = ids.length > 0 ? await this.users.findByIds(ids) : [];
    return new Map(owners.map((o) => [o.id, { id: o.id, name: o.name }]));
  }

  private async dayBudgets(
    provider: ItineraryBudgetProvider | undefined,
    itinerary: ItineraryDocument,
  ): Promise<DayBudgets | null> {
    if (!provider) return null;
    try {
      return await provider.dayTotals(itinerary.id, itinerary.owner.toString());
    } catch (error) {
      this.logger.error(
        `Could not load the budget totals of public itinerary ${itinerary.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /** A bad currency is the visitor's mistake (400); a rate outage is not, so the page still opens. */
  private async budgetOf(
    provider: ItineraryBudgetProvider | undefined,
    itineraryId: string,
    currency?: string,
  ): Promise<BudgetSummaryView | null> {
    if (!provider?.publicSummary) return null;
    try {
      return await provider.publicSummary(itineraryId, currency);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `Could not load the budget of public itinerary ${itineraryId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
