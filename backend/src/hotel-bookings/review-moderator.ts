import { Injectable, OnModuleInit } from '@nestjs/common';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import type {
  ContentModerator,
  ModeratedContent,
} from '../admin/content-moderators';
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
 */
@Injectable()
export class ReviewModerator implements ContentModerator, OnModuleInit {
  constructor(
    private readonly reviews: HotelReviewsService,
    private readonly moderators: ContentModerators,
  ) {}

  onModuleInit(): void {
    this.moderators.register(ContentType.REVIEW, this);
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
