import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ContentModerators, ContentType } from '../admin/content-moderators';
import type {
  ContentModerator,
  ModeratedContent,
} from '../admin/content-moderators';
import { imageUrlsOf } from './activity-images';
import { ActivityImagesService } from './activity-images.service';
import { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryRepository } from './itinerary.repository';
import type { ItineraryDocument } from './schemas/itinerary.schema';

function describeContent(itinerary: ItineraryDocument): ModeratedContent {
  return { authorId: itinerary.owner.toString(), title: itinerary.title };
}

/**
 * GEN-10: lets an admin hide or delete any itinerary. Registers itself with
 * the admin module's `ContentModerators` when the application starts.
 */
@Injectable()
export class ItineraryModerator implements ContentModerator, OnModuleInit {
  private readonly logger = new Logger(ItineraryModerator.name);

  constructor(
    private readonly repository: ItineraryRepository,
    private readonly budgets: ItineraryBudgets,
    private readonly moderators: ContentModerators,
    private readonly images: ActivityImagesService,
  ) {}

  onModuleInit(): void {
    this.moderators.register(ContentType.ITINERARY, this);
  }

  async hide(id: string): Promise<ModeratedContent | null> {
    const itinerary = await this.repository.hideById(id);
    return itinerary ? describeContent(itinerary) : null;
  }

  async delete(id: string): Promise<ModeratedContent | null> {
    const itinerary = await this.repository.deleteById(id);
    if (!itinerary) return null;
    try {
      await this.budgets.get()?.removeItinerary(id);
    } catch (error) {
      this.logger.error(
        'Could not clean up the budget entries',
        error instanceof Error ? error.stack : String(error),
      );
    }
    // The author uploaded the pictures, so the files are removed in their name (ITN-12).
    await this.images.discard(
      imageUrlsOf(itinerary.days),
      itinerary.owner.toString(),
    );
    return describeContent(itinerary);
  }
}
