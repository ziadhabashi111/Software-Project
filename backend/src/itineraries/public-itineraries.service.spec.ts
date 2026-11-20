import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthorItineraries } from '../blog/author-itineraries';
import { UserStatus } from '../users/user-status';
import type { UsersService } from '../users/users.service';
import { ItineraryBudgets } from './itinerary-budgets';
import type { ItineraryBudgetProvider } from './itinerary-budgets';
import type { ItineraryRepository } from './itinerary.repository';
import { PlaceCatalog } from './places';
import { PublicItinerariesService } from './public-itineraries.service';
import { PublicSearchQueryDto } from './dto/public-search-query.dto';
import { Visibility } from './schemas/itinerary.schema';

const OWNER = new Types.ObjectId();

function itinerary(overrides: Record<string, unknown> = {}) {
  const id = new Types.ObjectId();
  return {
    id: id.toString(),
    _id: id,
    owner: OWNER,
    title: 'A week in Egypt',
    countries: ['EG'],
    startDate: new Date('2027-03-01T00:00:00Z'),
    visibility: Visibility.PUBLIC,
    isHidden: false,
    days: [
      { _id: new Types.ObjectId(), city: 'cairo', activities: [] },
      { _id: new Types.ObjectId(), city: 'luxor', activities: [] },
    ],
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-02'),
    ...overrides,
  };
}

function build(options: {
  found?: ReturnType<typeof itinerary> | null;
  ownerStatus?: UserStatus | null;
  provider?: Partial<ItineraryBudgetProvider>;
  keyword?: { countryCodes: string[]; cityIds: string[] };
}) {
  const repository = {
    findById: jest.fn().mockResolvedValue(options.found ?? null),
    searchPublic: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    publicForAuthor: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const users = {
    findById: jest.fn().mockResolvedValue(
      options.ownerStatus === null
        ? null
        : {
            id: OWNER.toString(),
            name: 'Nora',
            status: options.ownerStatus ?? UserStatus.ACTIVE,
          },
    ),
    findByIds: jest.fn().mockResolvedValue([]),
  };
  const places = new PlaceCatalog();
  if (options.keyword) {
    places.register({
      isCountry: () => Promise.resolve(true),
      isCity: () => Promise.resolve(true),
      matchKeyword: () => Promise.resolve(options.keyword!),
    });
  }
  const budgets = new ItineraryBudgets();
  if (options.provider) {
    budgets.register({
      dayTotals: () => Promise.resolve({ currency: 'USD', byDay: {} }),
      removeDay: () => Promise.resolve(),
      removeItinerary: () => Promise.resolve(),
      ...options.provider,
    });
  }
  const authors = new AuthorItineraries();
  const service = new PublicItinerariesService(
    repository as unknown as ItineraryRepository,
    places,
    budgets,
    users as unknown as UsersService,
    authors,
  );
  return { service, repository, authors };
}

const query = (overrides: Partial<PublicSearchQueryDto> = {}) =>
  Object.assign(new PublicSearchQueryDto(), { page: 1, limit: 10 }, overrides);

describe('PublicItinerariesService.get (ITN-21)', () => {
  it('shows a public itinerary with its author', async () => {
    const { service } = build({ found: itinerary() });
    const view = await service.get(itinerary().id);
    expect(view.author).toEqual({ id: OWNER.toString(), name: 'Nora' });
    expect(view.title).toBe('A week in Egypt');
    expect(view.days).toHaveLength(2);
    expect('isHidden' in view).toBe(false);
    expect('visibility' in view).toBe(false);
  });

  it.each([
    ['private', { visibility: Visibility.PRIVATE }],
    ['hidden by a moderator', { isHidden: true }],
  ])('answers 404 for an itinerary that is %s', async (_name, change) => {
    const { service } = build({ found: itinerary(change) });
    await expect(service.get('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 when the owner is deactivated or gone, and when it does not exist', async () => {
    await expect(
      build({
        found: itinerary(),
        ownerStatus: UserStatus.DEACTIVATED,
      }).service.get('x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build({ found: itinerary(), ownerStatus: null }).service.get('x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build({ found: null }).service.get('x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still shows the itinerary when the budget module fails', async () => {
    const { service } = build({
      found: itinerary(),
      provider: {
        dayTotals: () => Promise.reject(new Error('rates down')),
        publicSummary: () => Promise.reject(new Error('rates down')),
      },
    });
    const view = await service.get('x');
    expect(view.budget).toBeNull();
    expect(view.groups[0].subtotal).toBeNull();
  });

  it('passes a bad currency back as a 400 instead of hiding it', async () => {
    const { service } = build({
      found: itinerary(),
      provider: {
        publicSummary: () => Promise.reject(new BadRequestException('bad')),
      },
    });
    await expect(service.get('x', 'ZZZ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PublicItinerariesService.search (ITN-21)', () => {
  it('rejects fewest days above most days', async () => {
    const { service, repository } = build({});
    await expect(
      service.search(query({ minDays: 9, maxDays: 3 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.searchPublic).not.toHaveBeenCalled();
  });

  it('turns a keyword into the countries and cities it names, plus the literal code or id', async () => {
    const { service, repository } = build({
      keyword: { countryCodes: ['EG'], cityIds: ['cairo'] },
    });
    await service.search(query({ q: 'Cairo' }));
    const [match] = repository.searchPublic.mock.calls[0] as [
      { $and: { $or: Record<string, unknown>[] }[] },
    ];
    const or = match.$and[0].$or;
    expect(or).toContainEqual({ countries: { $in: ['EG'] } });
    expect(or).toContainEqual({ 'days.city': { $in: ['cairo'] } });
  });

  it('still searches the title and the keyword as a city id when no reference data is registered', async () => {
    const { service, repository } = build({});
    await service.search(query({ q: 'trip' }));
    const [match] = repository.searchPublic.mock.calls[0] as [
      { $and: { $or: unknown[] }[] },
    ];
    expect(match.$and[0].$or).toHaveLength(2);
  });
});

describe('PublicItinerariesService as the author-page source (BLG-12)', () => {
  it('registers itself with the blog module on start-up', () => {
    const { service, authors } = build({});
    service.onModuleInit();
    return expect(
      authors.publicForAuthor('a', { skip: 0, limit: 5 }),
    ).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('lists only what the repository calls public, as summaries', async () => {
    const row = itinerary();
    const { service, repository } = build({});
    repository.publicForAuthor.mockResolvedValueOnce({
      items: [row],
      total: 1,
    });
    expect(await service.publicForAuthor('a', { skip: 0, limit: 5 })).toEqual({
      items: [
        {
          id: row.id,
          title: 'A week in Egypt',
          countries: ['EG'],
          startDate: '2027-03-01',
          dayCount: 2,
        },
      ],
      total: 1,
    });
  });
});

describe('PublicItinerariesService as the post-link source (BLG-13)', () => {
  const summaryOf = (row: ReturnType<typeof itinerary>) => ({
    id: row.id,
    title: 'A week in Egypt',
    countries: ['EG'],
    startDate: '2027-03-01',
    dayCount: 2,
  });

  describe('ownedBy', () => {
    it("returns the author's own public itinerary as public", async () => {
      const row = itinerary();
      const { service } = build({ found: row });
      expect(await service.ownedBy(OWNER.toString(), row.id)).toEqual({
        ...summaryOf(row),
        isPublic: true,
      });
    });

    it.each([
      ['private', { visibility: Visibility.PRIVATE }],
      ['hidden by a moderator', { isHidden: true }],
    ])('returns an itinerary that is %s as not public', async (_n, change) => {
      const row = itinerary(change);
      const { service } = build({ found: row });
      expect(await service.ownedBy(OWNER.toString(), row.id)).toMatchObject({
        id: row.id,
        isPublic: false,
      });
    });

    // Someone else's itinerary must look exactly like one that does not exist.
    it("returns null for someone else's itinerary and for an unknown one", async () => {
      const row = itinerary();
      const { service } = build({ found: row });
      expect(
        await service.ownedBy(new Types.ObjectId().toString(), row.id),
      ).toBeNull();
      expect(
        await build({ found: null }).service.ownedBy(OWNER.toString(), 'x'),
      ).toBeNull();
    });

    it('returns null for an id that is not a valid id', async () => {
      const { service, repository } = build({ found: itinerary() });
      repository.findById.mockResolvedValue(null);
      expect(await service.ownedBy(OWNER.toString(), 'nope')).toBeNull();
    });
  });

  describe('publicSummary', () => {
    it('summarises a public itinerary of an active author', async () => {
      const row = itinerary();
      const { service } = build({ found: row });
      expect(await service.publicSummary(row.id)).toEqual(summaryOf(row));
    });

    // A post must stop advertising an itinerary the moment it stops being public.
    it.each([
      ['private', { visibility: Visibility.PRIVATE }],
      ['hidden by a moderator', { isHidden: true }],
    ])('shows nothing for an itinerary that is %s', async (_n, change) => {
      const { service } = build({ found: itinerary(change) });
      expect(await service.publicSummary('x')).toBeNull();
    });

    it('shows nothing when the owner is deactivated or gone, or the itinerary is', async () => {
      const row = itinerary();
      expect(
        await build({
          found: row,
          ownerStatus: UserStatus.DEACTIVATED,
        }).service.publicSummary(row.id),
      ).toBeNull();
      expect(
        await build({ found: row, ownerStatus: null }).service.publicSummary(
          row.id,
        ),
      ).toBeNull();
      expect(
        await build({ found: null }).service.publicSummary('x'),
      ).toBeNull();
    });
  });
});
