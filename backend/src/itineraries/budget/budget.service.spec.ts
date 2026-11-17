import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import { ItineraryRepository } from '../itinerary.repository';
import { PlaceCatalog } from '../places';
import { BudgetService } from './budget.service';
import { BudgetCategory, TransportMode } from './budget-categories';
import type { BudgetEntry } from './schemas/budget-entry.schema';
import type { TransportCost } from './schemas/transport-cost.schema';

/** Arguments of one recorded call to a jest mock. */
const argsOf = (mock: jest.Mock, call = 0): unknown[] =>
  mock.mock.calls[call] as unknown[];

const owner: AuthUser = { id: 'owner1', role: Role.USER };
const stranger: AuthUser = { id: 'owner2', role: Role.USER };

const ITINERARY_ID = new Types.ObjectId();
const DAY_ID = new Types.ObjectId();

const itinerary = () => ({
  _id: ITINERARY_ID,
  id: ITINERARY_ID.toString(),
  owner: new Types.ObjectId(),
  days: [{ _id: DAY_ID }],
});

function entryDoc(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    id: 'e1',
    itineraryId: ITINERARY_ID,
    dayId: DAY_ID,
    category: BudgetCategory.FOOD,
    amount: 40,
    currency: 'EUR',
    note: undefined as string | undefined,
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return doc;
}

function build(options: { supported?: boolean; knownCity?: boolean } = {}) {
  const entryModel = {
    create: jest
      .fn()
      .mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({ id: 'new', ...doc }),
      ),
    findById: jest.fn().mockResolvedValue(entryDoc()),
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const costModel = {
    create: jest
      .fn()
      .mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({ id: 'tc', ...doc }),
      ),
    findById: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
    deleteMany: jest.fn().mockResolvedValue({}),
  };
  const repository = {
    loadOwned: jest
      .fn()
      .mockImplementation((_id: string, user: AuthUser) =>
        user.id === owner.id
          ? Promise.resolve(itinerary())
          : Promise.reject(new NotFoundException('Itinerary not found')),
      ),
  };
  const places = new PlaceCatalog();
  if (options.knownCity !== undefined) {
    places.register({
      isCountry: () => Promise.resolve(true),
      isCity: () => Promise.resolve(options.knownCity as boolean),
    });
  }
  const catalog =
    options.supported === undefined
      ? undefined
      : { isSupported: jest.fn().mockResolvedValue(options.supported) };
  const service = new BudgetService(
    entryModel as unknown as Model<BudgetEntry>,
    costModel as unknown as Model<TransportCost>,
    repository as unknown as ItineraryRepository,
    places,
    catalog,
  );
  return { service, entryModel, costModel, repository };
}

const dto = {
  category: BudgetCategory.FOOD,
  amount: 40,
  currency: 'EUR',
  note: 'Dinner',
};

describe('budget entries (ITN-14)', () => {
  it('adds an entry to a day of the owner’s itinerary', async () => {
    const { service, entryModel } = build();
    const view = await service.createEntry(
      owner,
      ITINERARY_ID.toString(),
      DAY_ID.toString(),
      dto,
    );
    expect(view).toMatchObject({
      category: 'food',
      amount: 40,
      currency: 'EUR',
      note: 'Dinner',
    });
    expect(
      String((argsOf(entryModel.create)[0] as { dayId: Types.ObjectId }).dayId),
    ).toBe(DAY_ID.toString());
  });

  it('answers 404 for someone else’s itinerary and saves nothing', async () => {
    const { service, entryModel } = build();
    await expect(
      service.createEntry(
        stranger,
        ITINERARY_ID.toString(),
        DAY_ID.toString(),
        dto,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(entryModel.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a day that is not in the itinerary', async () => {
    const { service } = build();
    await expect(
      service.createEntry(
        owner,
        ITINERARY_ID.toString(),
        new Types.ObjectId().toString(),
        dto,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a currency outside the supported list', async () => {
    const { service, entryModel } = build({ supported: false });
    await expect(
      service.createEntry(owner, ITINERARY_ID.toString(), DAY_ID.toString(), {
        ...dto,
        currency: 'XXX',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(entryModel.create).not.toHaveBeenCalled();
  });

  it('edits only the owner’s entry', async () => {
    const { service, entryModel } = build();
    const doc = entryDoc();
    entryModel.findById.mockResolvedValue(doc);
    await service.updateEntry(owner, 'e1', {
      amount: 55,
      category: BudgetCategory.ACTIVITIES,
    });
    expect(doc.amount).toBe(55);
    expect(doc.category).toBe('activities');
    expect(doc.save).toHaveBeenCalled();

    const other = entryDoc();
    entryModel.findById.mockResolvedValue(other);
    await expect(
      service.updateEntry(stranger, 'e1', { amount: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(other.save).not.toHaveBeenCalled();
  });

  it('deletes only the owner’s entry, and a missing one is 404', async () => {
    const { service, entryModel } = build();
    const doc = entryDoc();
    entryModel.findById.mockResolvedValue(doc);
    await service.deleteEntry(owner, 'e1');
    expect(doc.deleteOne).toHaveBeenCalled();

    const other = entryDoc();
    entryModel.findById.mockResolvedValue(other);
    await expect(service.deleteEntry(stranger, 'e1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(other.deleteOne).not.toHaveBeenCalled();

    entryModel.findById.mockResolvedValue(null);
    await expect(service.deleteEntry(owner, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('transport costs (ITN-16)', () => {
  const cost = {
    dayId: DAY_ID.toString(),
    mode: TransportMode.TRAIN,
    fromCity: 'cairo',
    toCity: 'luxor',
    amount: 35,
    currency: 'USD',
  };

  it('adds a transport cost between two different cities', async () => {
    const { service } = build({ knownCity: true });
    await expect(
      service.createTransport(owner, ITINERARY_ID.toString(), cost),
    ).resolves.toMatchObject({
      mode: 'train',
      fromCity: 'cairo',
      toCity: 'luxor',
      amount: 35,
    });
  });

  it('rejects the same city twice and unknown cities', async () => {
    const same = build({ knownCity: true });
    await expect(
      same.service.createTransport(owner, ITINERARY_ID.toString(), {
        ...cost,
        toCity: 'cairo',
      }),
    ).rejects.toMatchObject({ status: 400 });
    const unknown = build({ knownCity: false });
    await expect(
      unknown.service.createTransport(owner, ITINERARY_ID.toString(), cost),
    ).rejects.toMatchObject({ status: 400 });
    expect(unknown.costModel.create).not.toHaveBeenCalled();
  });

  it('keeps transport costs private to the owner', async () => {
    const { service, costModel } = build();
    await expect(
      service.createTransport(stranger, ITINERARY_ID.toString(), cost),
    ).rejects.toBeInstanceOf(NotFoundException);
    const doc = {
      ...entryDoc(),
      fromCity: 'cairo',
      toCity: 'luxor',
      mode: 'train',
    };
    costModel.findById.mockResolvedValue(doc);
    await expect(
      service.deleteTransport(stranger, 'tc1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(doc.deleteOne).not.toHaveBeenCalled();
  });

  it('checks both cities again when only one changes', async () => {
    const { service, costModel } = build({ knownCity: true });
    const doc = {
      ...entryDoc(),
      fromCity: 'cairo',
      toCity: 'luxor',
      mode: 'train',
    };
    costModel.findById.mockResolvedValue(doc);
    await expect(
      service.updateTransport(owner, 'tc1', { toCity: 'cairo' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe('cleanup (ITN-07)', () => {
  it('removes a deleted day’s entries and transport costs', async () => {
    const { service, entryModel, costModel } = build();
    await service.removeDay(ITINERARY_ID.toString(), DAY_ID.toString());
    for (const model of [entryModel, costModel]) {
      const filter = argsOf(model.deleteMany)[0] as {
        itineraryId: Types.ObjectId;
        dayId: Types.ObjectId;
      };
      expect(String(filter.itineraryId)).toBe(ITINERARY_ID.toString());
      expect(String(filter.dayId)).toBe(DAY_ID.toString());
    }
  });

  it('removes everything of a deleted itinerary', async () => {
    const { service, entryModel, costModel } = build();
    await service.removeItinerary(ITINERARY_ID.toString());
    expect(entryModel.deleteMany).toHaveBeenCalledTimes(1);
    expect(costModel.deleteMany).toHaveBeenCalledTimes(1);
  });
});
