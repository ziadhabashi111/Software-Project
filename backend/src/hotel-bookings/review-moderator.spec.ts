import type { ModuleRef } from '@nestjs/core';
import { Types } from 'mongoose';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import { Role, type AuthUser } from '../auth/auth.types';
import { ReportTargets } from '../blog/reports/report-targets';
import type { HotelReviewsService } from './hotel-reviews.service';
import { ReviewModerator } from './review-moderator';
import type { HotelReviewDocument } from './schemas/hotel-review.schema';

const AUTHOR = new Types.ObjectId().toHexString();
const REPORTER: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  email: 'reporter@example.com',
  role: Role.USER,
} as AuthUser;

function review(overrides: Partial<HotelReviewDocument> = {}) {
  return {
    user: new Types.ObjectId(AUTHOR),
    hotelName: 'Nile View',
    rating: 4,
    isHidden: false,
    ...overrides,
  } as HotelReviewDocument;
}

describe('ReviewModerator as the review report target (GEN-09)', () => {
  let targets: ReportTargets;
  let stored: HotelReviewDocument | null;
  let moderator: ReviewModerator;

  beforeEach(() => {
    targets = new ReportTargets();
    stored = review();
    const reviews = {
      findById: jest.fn(() => Promise.resolve(stored)),
    } as unknown as HotelReviewsService;
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === ReportTargets) return targets;
        throw new Error('not found');
      }),
    } as unknown as ModuleRef;
    moderator = new ReviewModerator(
      reviews,
      new ContentModerators(),
      moduleRef,
    );
    moderator.onApplicationBootstrap();
  });

  it('registers itself for reviews when the blog reports module is loaded', () => {
    expect(targets.get(ContentType.REVIEW)).toBe(moderator);
  });

  it('reports an unknown review as missing', async () => {
    stored = null;
    await expect(
      targets.get(ContentType.REVIEW)?.find('x', REPORTER),
    ).resolves.toBeNull();
  });

  it('gives the author, and hides a hidden review from reporters', async () => {
    await expect(
      targets
        .get(ContentType.REVIEW)
        ?.find(new Types.ObjectId().toHexString(), REPORTER),
    ).resolves.toEqual({ authorId: AUTHOR, visibleToReporter: true });

    stored = review({ isHidden: true });
    await expect(
      targets
        .get(ContentType.REVIEW)
        ?.find(new Types.ObjectId().toHexString(), REPORTER),
    ).resolves.toEqual({ authorId: AUTHOR, visibleToReporter: false });
  });

  it('starts without the blog module (no ReportTargets provider)', () => {
    const lonely = new ReviewModerator(
      {} as HotelReviewsService,
      new ContentModerators(),
      {
        get: () => {
          throw new Error('not found');
        },
      } as unknown as ModuleRef,
    );
    expect(() => lonely.onApplicationBootstrap()).not.toThrow();
  });
});
