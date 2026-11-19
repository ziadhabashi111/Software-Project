import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import { CreateDayDto } from './dto/create-day.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateDayDto } from './dto/update-day.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { imageUrlsOf } from './activity-images';
import { ActivityImagesService } from './activity-images.service';
import { parseDate } from './itinerary-dates';
import { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryRepository } from './itinerary.repository';
import {
  DayBudgets,
  ItinerarySummary,
  ItineraryView,
  toItineraryView,
  toSummary,
} from './itinerary-view';
import { PlaceCatalog } from './places';
import type {
  ItineraryDay,
  ItineraryDocument,
} from './schemas/itinerary.schema';

export const MAX_DAYS = 60;

type Caller = Pick<AuthUser, 'id' | 'role'>;

/** ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-09, ITN-20 */
@Injectable()
export class ItinerariesService {
  private readonly logger = new Logger(ItinerariesService.name);

  constructor(
    private readonly repository: ItineraryRepository,
    private readonly places: PlaceCatalog,
    private readonly budgets: ItineraryBudgets,
    private readonly images: ActivityImagesService,
  ) {}

  async create(user: Caller, dto: CreateItineraryDto): Promise<ItineraryView> {
    await this.assertCountries(dto.countries);
    const itinerary = await this.repository.create({
      owner: user.id,
      title: dto.title,
      countries: dto.countries,
      startDate: parseDate(dto.startDate),
    });
    return this.view(itinerary);
  }

  /** Mine, most recently updated first (ITN-03). */
  async list(
    user: Caller,
    query: { page: number; limit: number },
  ): Promise<Paginated<ItinerarySummary>> {
    const { items, total } = await this.repository.pageForOwner(user.id, {
      skip: skipFor(query),
      limit: query.limit,
    });
    return toPage(items.map(toSummary), total, query);
  }

  async get(user: Caller, id: string): Promise<ItineraryView> {
    return this.view(await this.repository.loadOwned(id, user));
  }

  async update(
    user: Caller,
    id: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryView> {
    if (dto.countries) await this.assertCountries(dto.countries);
    const { itinerary } = await this.repository.change(id, user, (doc) => {
      if (dto.title !== undefined) doc.title = dto.title;
      if (dto.countries !== undefined) doc.countries = dto.countries;
      if (dto.startDate !== undefined) doc.startDate = parseDate(dto.startDate);
      if (dto.visibility !== undefined) doc.visibility = dto.visibility;
    });
    return this.view(itinerary);
  }

  /** Clones other users made earlier are separate copies and stay untouched. */
  async remove(user: Caller, id: string): Promise<void> {
    const itinerary = await this.repository.loadOwned(id, user);
    await this.repository.deleteById(id);
    await this.tellBudgets((provider) => provider.removeItinerary(id));
    // Its pictures go with it (ITN-12).
    await this.images.discard(imageUrlsOf(itinerary.days), user.id);
  }

  async addDay(
    user: Caller,
    id: string,
    dto: CreateDayDto,
  ): Promise<ItineraryView> {
    await this.assertCity(dto.city);
    const { itinerary } = await this.repository.change(id, user, (doc) => {
      if (doc.days.length >= MAX_DAYS) throw maxDaysReached();
      doc.days.push({
        city: dto.city,
        ...(dto.notes ? { notes: dto.notes } : {}),
        activities: [],
      } as unknown as ItineraryDay); // Mongoose adds the _id
    });
    return this.view(itinerary);
  }

  async updateDay(
    user: Caller,
    id: string,
    dayId: string,
    dto: UpdateDayDto,
  ): Promise<ItineraryView> {
    if (dto.city) await this.assertCity(dto.city);
    const { itinerary } = await this.repository.change(id, user, (doc) => {
      const day = findDay(doc, dayId);
      if (dto.city !== undefined) day.city = dto.city;
      if (dto.notes !== undefined) {
        day.notes =
          dto.notes === null || dto.notes === '' ? undefined : dto.notes;
      }
    });
    return this.view(itinerary);
  }

  /** The remaining days are renumbered and re-dated by their position (ITN-07). */
  async removeDay(
    user: Caller,
    id: string,
    dayId: string,
  ): Promise<ItineraryView> {
    let imageUrls: string[] = [];
    const { itinerary } = await this.repository.change(id, user, (doc) => {
      const index = indexOfDay(doc, dayId);
      imageUrls = imageUrlsOf([doc.days[index]]);
      doc.days.splice(index, 1);
    });
    await this.tellBudgets((provider) => provider.removeDay(id, dayId));
    // The day's activities are gone, so are their pictures (ITN-12).
    await this.images.discard(imageUrls, user.id);
    return this.view(itinerary);
  }

  /** Moves one day to a new 1-based position (ITN-08). */
  async moveDay(
    user: Caller,
    id: string,
    dayId: string,
    position: number,
  ): Promise<ItineraryView> {
    const { itinerary } = await this.repository.change(id, user, (doc) => {
      const from = indexOfDay(doc, dayId);
      if (position > doc.days.length) {
        throw fieldError(
          'position',
          `Position must be between 1 and ${doc.days.length}`,
        );
      }
      const to = position - 1;
      if (from === to) return;
      const [day] = doc.days.splice(from, 1);
      doc.days.splice(to, 0, day);
    });
    return this.view(itinerary);
  }

  /**
   * The itinerary with its numbered days and city groups. Group subtotals
   * come from the budget module; if it is missing or fails they are null, so
   * the itinerary itself always loads.
   */
  private async view(itinerary: ItineraryDocument): Promise<ItineraryView> {
    return toItineraryView(itinerary, await this.dayBudgets(itinerary));
  }

  private async dayBudgets(
    itinerary: ItineraryDocument,
  ): Promise<DayBudgets | null> {
    const provider = this.budgets.get();
    if (!provider || itinerary.days.length === 0) return null;
    try {
      return await provider.dayTotals(itinerary.id, itinerary.owner.toString());
    } catch (error) {
      this.logger.error(
        'Could not load the budget totals',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /** The change is already saved; a budget cleanup that fails is logged only. */
  private async tellBudgets(
    action: (
      provider: NonNullable<ReturnType<ItineraryBudgets['get']>>,
    ) => Promise<void>,
  ): Promise<void> {
    const provider = this.budgets.get();
    if (!provider) return;
    try {
      await action(provider);
    } catch (error) {
      this.logger.error(
        'Could not clean up the budget entries',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async assertCountries(countries: string[]): Promise<void> {
    const lists = this.places.get();
    if (!lists) return;
    for (const code of countries) {
      if (!(await lists.isCountry(code))) {
        throw fieldError('countries', `${code} is not a supported country`);
      }
    }
  }

  private async assertCity(city: string): Promise<void> {
    const lists = this.places.get();
    if (lists && !(await lists.isCity(city))) {
      throw fieldError('city', `${city} is not a supported city`);
    }
  }
}

function maxDaysReached(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: `An itinerary can have at most ${MAX_DAYS} days`,
    code: 'MAX_DAYS_REACHED',
  });
}

function indexOfDay(itinerary: ItineraryDocument, dayId: string): number {
  const index = itinerary.days.findIndex((day) => day._id.toString() === dayId);
  if (index === -1) throw new NotFoundException('Day not found');
  return index;
}

function findDay(itinerary: ItineraryDocument, dayId: string) {
  return itinerary.days[indexOfDay(itinerary, dayId)];
}
