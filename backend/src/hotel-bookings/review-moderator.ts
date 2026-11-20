import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import type {
  ContentModerator,
  ModeratedContent,
} from '../admin/content-moderators';
import { ReportTargets } from '../blog/reports/report-targets';
import type {
  ReportTarget,
  ReportTargetInfo,
} from '../blog/reports/report-targets';
import { HotelReviewsService } from './hotel-reviews.service';
import type { HotelReviewDocument } from './schemas/hotel-review.schema';

function describe(review: HotelReviewDocument): ModeratedContent {
  return {
    authorId: review.user.toString(),
    title: `Review of ${review.hotelName} (${review.rating}/5)`,
  };
}

/**
 * GEN-10: lets an admin hide or delete any hotel review (directly or from a
 * report). Registers itself with the admin module when the app starts.
 *
 * GEN-09: also the report checker for reviews, so a report needs a review
 * that exists, is not hidden and is not the reporter's own. The blog's
 * `ReportTargets` is looked up rather than imported, because importing the
 * blog module here would tie the two modules together for one registration.
 */
@Injectable()
export class ReviewModerator
  implements
    ContentModerator,
    ReportTarget,
    OnModuleInit,
    OnApplicationBootstrap
{
  constructor(
    private readonly reviews: HotelReviewsService,
    private readonly moderators: ContentModerators,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.moderators.register(ContentType.REVIEW, this);
  }

  onApplicationBootstrap(): void {
    let targets: ReportTargets | undefined;
    try {
      targets = this.moduleRef.get(ReportTargets, { strict: false });
    } catch {
      return; // the blog module is not loaded: nobody can report anything
    }
    targets.register(ContentType.REVIEW, this);
  }

  async find(id: string): Promise<ReportTargetInfo | null> {
    const review = await this.reviews.findById(id);
    if (!review) return null;
    return {
      authorId: review.user.toString(),
      visibleToReporter: !review.isHidden,
    };
  }

  async hide(id: string): Promise<ModeratedContent | null> {
    const review = await this.reviews.hideById(id);
    return review ? describe(review) : null;
  }

  /**
   * Restores a hidden review. Not part of the admin `ContentModerator`
   * interface yet; ready for an "unhide" action in the admin module.
   */
  async unhide(id: string): Promise<ModeratedContent | null> {
    const review = await this.reviews.unhideById(id);
    return review ? describe(review) : null;
  }

  async delete(id: string): Promise<ModeratedContent | null> {
    const review = await this.reviews.deleteById(id);
    return review ? describe(review) : null;
  }
}
