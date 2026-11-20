import {
  Injectable,
  Logger,
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
import { imageUrlsOf } from './activity-images';
import { ActivityImagesService } from './activity-images.service';
import { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryRepository } from './itinerary.repository';
import { Visibility } from './schemas/itinerary.schema';
import type { ItineraryDocument } from './schemas/itinerary.schema';

function describeContent(itinerary: ItineraryDocument): ModeratedContent {
  return { authorId: itinerary.owner.toString(), title: itinerary.title };
}

/**
 * GEN-10: lets an admin hide or delete any itinerary. Registers itself with
 * the admin module's `ContentModerators` when the application starts.
 *
 * GEN-09: also the report checker for itineraries, so a report needs a
 * public, visible itinerary that is not the reporter's own. The blog's
 * `ReportTargets` is looked up rather than imported (same as reviews), so
 * this module does not depend on the blog module.
 */
@Injectable()
export class ItineraryModerator
  implements
    ContentModerator,
    ReportTarget,
    OnModuleInit,
    OnApplicationBootstrap
{
  private readonly logger = new Logger(ItineraryModerator.name);

  constructor(
    private readonly repository: ItineraryRepository,
    private readonly budgets: ItineraryBudgets,
    private readonly moderators: ContentModerators,
    private readonly images: ActivityImagesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.moderators.register(ContentType.ITINERARY, this);
  }

  onApplicationBootstrap(): void {
    let targets: ReportTargets;
    try {
      targets = this.moduleRef.get(ReportTargets, { strict: false });
    } catch {
      return; // the blog module is not loaded: nobody can report anything
    }
    targets.register(ContentType.ITINERARY, this);
  }

  /** GEN-09: reporters can only see public itineraries an admin has not hidden. */
  async find(id: string): Promise<ReportTargetInfo | null> {
    const itinerary = await this.repository.findById(id);
    if (!itinerary) return null;
    return {
      authorId: itinerary.owner.toString(),
      visibleToReporter:
        itinerary.visibility === Visibility.PUBLIC && !itinerary.isHidden,
    };
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
