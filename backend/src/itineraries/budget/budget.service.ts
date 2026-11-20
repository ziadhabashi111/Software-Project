import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { AuthUser } from '../../auth/auth.types';
import { skipFor, toPage } from '../../common/pagination/pagination';
import type { PaginationQueryDto } from '../../common/pagination/pagination';
import { fieldError } from '../../common/validation/validation-errors';
import { CURRENCY_CATALOG } from '../../users/currency-catalog';
import type { CurrencyCatalog } from '../../users/currency-catalog';
import { ItineraryRepository } from '../itinerary.repository';
import { PlaceCatalog } from '../places';
import { ItineraryBooking } from '../schemas/itinerary-booking.schema';
import type { ItineraryDocument } from '../schemas/itinerary.schema';
import { remapToClone } from './budget-clone';
import { toBudgetEntryView, toTransportCostView } from './budget-view';
import type {
  BudgetEntryView,
  BudgetListView,
  TransportCostView,
} from './budget-view';
import { CreateBudgetEntryDto } from './dto/create-budget-entry.dto';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import { BudgetEntry } from './schemas/budget-entry.schema';
import { TransportCost } from './schemas/transport-cost.schema';

type Caller = Pick<AuthUser, 'id' | 'role'>;

/**
 * ITN-14 and ITN-16: budget entries and transport costs. Everything is
 * owner-only: the itinerary is loaded with the ownership check first, so
 * another user's ids answer 404 and never reveal that they exist (ACC-11).
 */
@Injectable()
export class BudgetService {
  constructor(
    @InjectModel(BudgetEntry.name)
    private readonly entries: Model<BudgetEntry>,
    @InjectModel(TransportCost.name)
    private readonly transport: Model<TransportCost>,
    @InjectModel(ItineraryBooking.name)
    private readonly links: Model<ItineraryBooking>,
    private readonly itineraries: ItineraryRepository,
    private readonly places: PlaceCatalog,
    @Optional()
    @Inject(CURRENCY_CATALOG)
    private readonly currencies?: CurrencyCatalog,
  ) {}

  /** The itinerary's entries and transport costs, for the budget screen. */
  /**
   * GEN-05: one page (10 rows) of entries and of transport costs, in the
   * order they were added. The same page number applies to both lists; each
   * reports its own total. Converted totals over every entry come from the
   * budget summary.
   */
  async list(
    user: Caller,
    itineraryId: string,
    page: PaginationQueryDto,
  ): Promise<BudgetListView> {
    await this.itineraries.loadOwned(itineraryId, user);
    const filter = { itineraryId: new Types.ObjectId(itineraryId) };
    const order = { createdAt: 1 as const, _id: 1 as const };
    const [entries, entryCount, transportCosts, transportCount] =
      await Promise.all([
        this.entries
          .find(filter)
          .sort(order)
          .skip(skipFor(page))
          .limit(page.limit),
        this.entries.countDocuments(filter),
        this.transport
          .find(filter)
          .sort(order)
          .skip(skipFor(page))
          .limit(page.limit),
        this.transport.countDocuments(filter),
      ]);
    return {
      entries: toPage(entries.map(toBudgetEntryView), entryCount, page),
      transportCosts: toPage(
        transportCosts.map(toTransportCostView),
        transportCount,
        page,
      ),
    };
  }

  async createEntry(
    user: Caller,
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryView> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    assertDay(itinerary, dayId);
    await this.assertCurrency(dto.currency);
    const entry = await this.entries.create({
      itineraryId: itinerary._id,
      dayId: new Types.ObjectId(dayId),
      category: dto.category,
      amount: dto.amount,
      currency: dto.currency,
      ...(dto.note ? { note: dto.note } : {}),
    });
    return toBudgetEntryView(entry);
  }

  async updateEntry(
    user: Caller,
    id: string,
    dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryView> {
    const entry = await this.entries.findById(id);
    if (!entry) throw new NotFoundException('Budget entry not found');
    await this.itineraries.loadOwned(entry.itineraryId.toString(), user);
    if (dto.currency !== undefined) await this.assertCurrency(dto.currency);

    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.amount !== undefined) entry.amount = dto.amount;
    if (dto.currency !== undefined) entry.currency = dto.currency;
    if (dto.note !== undefined) entry.note = dto.note || undefined;
    await entry.save();
    return toBudgetEntryView(entry);
  }

  async deleteEntry(user: Caller, id: string): Promise<void> {
    const entry = await this.entries.findById(id);
    if (!entry) throw new NotFoundException('Budget entry not found');
    await this.itineraries.loadOwned(entry.itineraryId.toString(), user);
    await entry.deleteOne();
  }

  async createTransport(
    user: Caller,
    itineraryId: string,
    dto: CreateTransportCostDto,
  ): Promise<TransportCostView> {
    const itinerary = await this.itineraries.loadOwned(itineraryId, user);
    assertDay(itinerary, dto.dayId);
    await this.assertCities(dto.fromCity, dto.toCity);
    await this.assertCurrency(dto.currency);
    const cost = await this.transport.create({
      itineraryId: itinerary._id,
      dayId: new Types.ObjectId(dto.dayId),
      mode: dto.mode,
      fromCity: dto.fromCity,
      toCity: dto.toCity,
      amount: dto.amount,
      currency: dto.currency,
    });
    return toTransportCostView(cost);
  }

  async updateTransport(
    user: Caller,
    id: string,
    dto: UpdateTransportCostDto,
  ): Promise<TransportCostView> {
    const cost = await this.transport.findById(id);
    if (!cost) throw new NotFoundException('Transport cost not found');
    const itinerary = await this.itineraries.loadOwned(
      cost.itineraryId.toString(),
      user,
    );
    if (dto.dayId !== undefined) assertDay(itinerary, dto.dayId);
    if (dto.currency !== undefined) await this.assertCurrency(dto.currency);

    const fromCity = dto.fromCity ?? cost.fromCity;
    const toCity = dto.toCity ?? cost.toCity;
    if (dto.fromCity !== undefined || dto.toCity !== undefined) {
      await this.assertCities(fromCity, toCity);
    }

    if (dto.dayId !== undefined) cost.dayId = new Types.ObjectId(dto.dayId);
    if (dto.mode !== undefined) cost.mode = dto.mode;
    cost.fromCity = fromCity;
    cost.toCity = toCity;
    if (dto.amount !== undefined) cost.amount = dto.amount;
    if (dto.currency !== undefined) cost.currency = dto.currency;
    await cost.save();
    return toTransportCostView(cost);
  }

  async deleteTransport(user: Caller, id: string): Promise<void> {
    const cost = await this.transport.findById(id);
    if (!cost) throw new NotFoundException('Transport cost not found');
    await this.itineraries.loadOwned(cost.itineraryId.toString(), user);
    await cost.deleteOne();
  }

  /** ITN-07: a deleted day takes its budget entries, transport costs and linked bookings (ITN-27) with it. */
  async removeDay(itineraryId: string, dayId: string): Promise<void> {
    const filter = {
      itineraryId: new Types.ObjectId(itineraryId),
      dayId: new Types.ObjectId(dayId),
    };
    await Promise.all([
      this.entries.deleteMany(filter),
      this.transport.deleteMany(filter),
      this.links.deleteMany(filter),
    ]);
  }

  /** A deleted itinerary takes everything that belongs to it. */
  async removeItinerary(itineraryId: string): Promise<void> {
    const filter = { itineraryId: new Types.ObjectId(itineraryId) };
    await Promise.all([
      this.entries.deleteMany(filter),
      this.transport.deleteMany(filter),
      this.links.deleteMany(filter),
    ]);
  }

  /** ITN-21: copies this itinerary's budget entries and transport costs onto its clone. */
  async cloneInto(
    fromItineraryId: string,
    toItineraryId: string,
    dayIdMap: Record<string, string>,
  ): Promise<void> {
    const source = { itineraryId: new Types.ObjectId(fromItineraryId) };
    const target = new Types.ObjectId(toItineraryId);
    const [entries, transportCosts] = await Promise.all([
      this.entries.find(source).lean(),
      this.transport.find(source).lean(),
    ]);
    await Promise.all([
      this.entries.insertMany(remapToClone(entries, dayIdMap, target)),
      this.transport.insertMany(remapToClone(transportCosts, dayIdMap, target)),
    ]);
  }

  /** The currency must be one the exchange rates cover (GEN-12, ITN-18). */
  private async assertCurrency(code: string): Promise<void> {
    if (this.currencies && !(await this.currencies.isSupported(code))) {
      throw fieldError('currency', `${code} is not a supported currency`);
    }
  }

  private async assertCities(from: string, to: string): Promise<void> {
    if (from === to) {
      throw fieldError(
        'toCity',
        'Intercity transport needs two different cities',
      );
    }
    const lists = this.places.get();
    if (!lists) return;
    if (!(await lists.isCity(from))) {
      throw fieldError('fromCity', `${from} is not a supported city`);
    }
    if (!(await lists.isCity(to))) {
      throw fieldError('toCity', `${to} is not a supported city`);
    }
  }
}

function assertDay(itinerary: ItineraryDocument, dayId: string): void {
  if (!itinerary.days.some((day) => day._id.toString() === dayId)) {
    throw new NotFoundException('Day not found');
  }
}
