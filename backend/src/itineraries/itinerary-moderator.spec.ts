import type { ModuleRef } from '@nestjs/core';
import { Types } from 'mongoose';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import { Role, type AuthUser } from '../auth/auth.types';
import { ReportTargets } from '../blog/reports/report-targets';
import type { ActivityImagesService } from './activity-images.service';
import type { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryModerator } from './itinerary-moderator';
import type { ItineraryRepository } from './itinerary.repository';
import { Visibility, type ItineraryDocument } from './schemas/itinerary.schema';

const OWNER = new Types.ObjectId().toHexString();
const REPORTER = {
  id: new Types.ObjectId().toHexString(),
  email: 'reporter@example.com',
  role: Role.USER,
} as AuthUser;

function itinerary(overrides: Partial<ItineraryDocument> = {}) {
  return {
    owner: new Types.ObjectId(OWNER),
    title: 'Ten days in Egypt',
    visibility: Visibility.PUBLIC,
    isHidden: false,
    ...overrides,
  } as ItineraryDocument;
}

describe('ItineraryModerator as the itinerary report target (GEN-09)', () => {
  let targets: ReportTargets;
  let stored: ItineraryDocument | null;
  let moderator: ItineraryModerator;
  const id = new Types.ObjectId().toHexString();

  function moduleRefWith(provider: ReportTargets | null): ModuleRef {
    return {
      get: jest.fn((token: unknown) => {
        if (provider && token === ReportTargets) return provider;
        throw new Error('not found');
      }),
    } as unknown as ModuleRef;
  }

  function build(moduleRef: ModuleRef): ItineraryModerator {
    const repository = {
      findById: jest.fn(() => Promise.resolve(stored)),
    } as unknown as ItineraryRepository;
    return new ItineraryModerator(
      repository,
      {} as ItineraryBudgets,
      new ContentModerators(),
      {} as ActivityImagesService,
      moduleRef,
    );
  }

  beforeEach(() => {
    targets = new ReportTargets();
    stored = itinerary();
    moderator = build(moduleRefWith(targets));
    moderator.onApplicationBootstrap();
  });

  it('registers itself for itineraries when the blog reports module is loaded', () => {
    expect(targets.get(ContentType.ITINERARY)).toBe(moderator);
  });

  it('reports an unknown itinerary as missing', async () => {
    stored = null;
    await expect(
      targets.get(ContentType.ITINERARY)?.find(id, REPORTER),
    ).resolves.toBeNull();
  });

  it('lets reporters see only public itineraries that are not hidden', async () => {
    await expect(
      targets.get(ContentType.ITINERARY)?.find(id, REPORTER),
    ).resolves.toEqual({ authorId: OWNER, visibleToReporter: true });

    stored = itinerary({ visibility: Visibility.PRIVATE });
    await expect(
      targets.get(ContentType.ITINERARY)?.find(id, REPORTER),
    ).resolves.toEqual({ authorId: OWNER, visibleToReporter: false });

    stored = itinerary({ isHidden: true });
    await expect(
      targets.get(ContentType.ITINERARY)?.find(id, REPORTER),
    ).resolves.toEqual({ authorId: OWNER, visibleToReporter: false });
  });

  it('starts without the blog module (no ReportTargets provider)', () => {
    const lonely = build(moduleRefWith(null));
    expect(() => lonely.onApplicationBootstrap()).not.toThrow();
  });
});
