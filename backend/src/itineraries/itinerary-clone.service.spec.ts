import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import { UserStatus } from '../users/user-status';
import type { UsersService } from '../users/users.service';
import { ItineraryBudgets } from './itinerary-budgets';
import type { ItineraryBudgetProvider } from './itinerary-budgets';
import { ItineraryCloneService } from './itinerary-clone.service';
import type { ItineraryRepository } from './itinerary.repository';
import type { ItinerariesService } from './itineraries.service';
import { Visibility } from './schemas/itinerary.schema';

const AUTHOR = new Types.ObjectId();
const ME = new Types.ObjectId().toString();
const me = { id: ME, role: Role.USER };

function source(overrides: Record<string, unknown> = {}) {
  const id = new Types.ObjectId();
  return {
    id: id.toString(),
    _id: id,
    owner: AUTHOR,
    title: 'Egypt',
    countries: ['EG'],
    startDate: new Date('2027-03-01T00:00:00Z'),
    visibility: Visibility.PUBLIC,
    isHidden: false,
    days: [
      {
        _id: new Types.ObjectId(),
        city: 'cairo',
        activities: [{ name: 'Pyramids' }],
      },
    ],
    ...overrides,
  };
}

function build(options: {
  found?: ReturnType<typeof source> | null;
  authorStatus?: UserStatus;
  provider?: Partial<ItineraryBudgetProvider>;
}) {
  const created = { id: new Types.ObjectId().toString() };
  const repository = {
    findById: jest.fn().mockResolvedValue(options.found ?? null),
    createClone: jest.fn().mockResolvedValue(created),
    deleteById: jest.fn().mockResolvedValue(null),
  };
  const users = {
    findById: jest.fn().mockResolvedValue({
      id: AUTHOR.toString(),
      name: 'Nora',
      status: options.authorStatus ?? UserStatus.ACTIVE,
    }),
  };
  const itineraries = {
    get: jest.fn().mockResolvedValue({ id: created.id }),
  };
  const budgets = new ItineraryBudgets();
  if (options.provider) {
    budgets.register({
      dayTotals: () => Promise.resolve({ currency: 'USD', byDay: {} }),
      removeDay: () => Promise.resolve(),
      removeItinerary: () => Promise.resolve(),
      ...options.provider,
    });
  }
  const service = new ItineraryCloneService(
    repository as unknown as ItineraryRepository,
    budgets,
    users as unknown as UsersService,
    itineraries as unknown as ItinerariesService,
  );
  return { service, repository, itineraries, created };
}

describe('ItineraryCloneService (ITN-21)', () => {
  it('copies a public itinerary into a private one of mine, crediting the author', async () => {
    const src = source();
    const { service, repository, itineraries, created } = build({ found: src });
    await service.clone(me, src.id);

    const [data] = repository.createClone.mock.calls[0] as [
      Record<string, unknown> & { clonedFrom: Record<string, unknown> },
    ];
    expect(data.owner).toBe(ME);
    expect(data.title).toBe('Egypt');
    expect(data.clonedFrom).toEqual({
      itinerary: src._id,
      author: AUTHOR,
      authorName: 'Nora',
    });
    expect(itineraries.get).toHaveBeenCalledWith(me, created.id);
  });

  it('hands the day id map to the budget module so budgets follow the days', async () => {
    const src = source();
    const cloneBudgets = jest.fn().mockResolvedValue(undefined);
    const { service, created } = build({
      found: src,
      provider: { cloneBudgets },
    });
    await service.clone(me, src.id);
    const [from, to, map] = cloneBudgets.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
    ];
    expect([from, to]).toEqual([src.id, created.id]);
    expect(Object.keys(map)).toEqual([src.days[0]._id.toString()]);
  });

  it('removes the half-made clone when the budget copy fails, and reports the failure', async () => {
    const src = source();
    const { service, repository, created } = build({
      found: src,
      provider: { cloneBudgets: () => Promise.reject(new Error('db down')) },
    });
    await expect(service.clone(me, src.id)).rejects.toThrow('db down');
    expect(repository.deleteById).toHaveBeenCalledWith(created.id);
  });

  it.each([
    ['private', { visibility: Visibility.PRIVATE }],
    ['hidden by a moderator', { isHidden: true }],
  ])(
    'answers 404 for someone else’s itinerary that is %s',
    async (_n, change) => {
      const src = source(change);
      const { service, repository } = build({ found: src });
      await expect(service.clone(me, src.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.createClone).not.toHaveBeenCalled();
    },
  );

  it('answers 404 when the author is deactivated, or the itinerary does not exist', async () => {
    const src = source();
    await expect(
      build({ found: src, authorStatus: UserStatus.DEACTIVATED }).service.clone(
        me,
        src.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build({ found: null }).service.clone(me, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets me copy my own private itinerary', async () => {
    const src = source({
      owner: new Types.ObjectId(ME),
      visibility: Visibility.PRIVATE,
    });
    const { service, repository } = build({ found: src });
    await service.clone(me, src.id);
    expect(repository.createClone).toHaveBeenCalled();
  });
});
