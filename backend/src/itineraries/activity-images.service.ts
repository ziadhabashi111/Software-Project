import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { assertCanAccess } from '../common/security/ownership';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.service';
import { locateActivity } from './activity-images';
import { ItineraryRepository } from './itinerary.repository';
import { toActivityView } from './itinerary-view';
import type { ActivityView } from './itinerary-view';

type Caller = Pick<AuthUser, 'id' | 'role'>;

/**
 * ITN-12: pictures of an activity, through the shared upload helper (GEN-08):
 * JPG or PNG, at most 5 MB each and 5 per activity. Only the itinerary's owner
 * can add or remove them (anyone else gets 404, and nothing is stored). The
 * files belong to the uploader, so the upload helper's ownership rule holds:
 * nobody else can reuse or delete them.
 */
@Injectable()
export class ActivityImagesService {
  private readonly logger = new Logger(ActivityImagesService.name);

  constructor(
    private readonly repository: ItineraryRepository,
    private readonly uploads: UploadsService,
  ) {}

  async add(
    user: Caller,
    activityId: string,
    files: ImageFile[] | undefined,
  ): Promise<ActivityView> {
    const itinerary = await this.repository.findByActivityId(activityId);
    if (!itinerary) throw new NotFoundException('Activity not found');
    // Someone else's activity answers 404 before a single file is written.
    assertCanAccess(itinerary.owner, user);
    const existing = locateActivity(itinerary.days, activityId).images.length;

    // Validates every file and the 5-image limit, then stores all or none.
    const stored = await this.uploads.saveImages(
      files,
      'activity',
      user.id,
      existing,
    );
    try {
      const { result } = await this.repository.change(
        itinerary.id,
        user,
        (doc) => {
          const activity = locateActivity(doc.days, activityId);
          // Checked again on the latest state: a parallel upload may have
          // filled the activity (or it was deleted) since we looked.
          this.uploads.assertCanAdd(
            'activity',
            activity.images.length,
            stored.length,
          );
          for (const image of stored) {
            activity.images.push({ _id: new Types.ObjectId(), url: image.url });
          }
          return activity;
        },
      );
      return toActivityView(result);
    } catch (error) {
      await this.discard(
        stored.map((image) => image.url),
        user.id,
      );
      throw error;
    }
  }

  async remove(
    user: Caller,
    activityId: string,
    imageId: string,
  ): Promise<ActivityView> {
    const itinerary = await this.repository.findByActivityId(activityId);
    if (!itinerary) throw new NotFoundException('Activity not found');
    assertCanAccess(itinerary.owner, user);

    let removedUrl: string | undefined;
    const { result } = await this.repository.change(
      itinerary.id,
      user,
      (doc) => {
        const activity = locateActivity(doc.days, activityId);
        const index = activity.images.findIndex(
          (image) => image._id.toString() === imageId,
        );
        if (index === -1) throw new NotFoundException('Image not found');
        removedUrl = activity.images[index].url;
        activity.images.splice(index, 1);
        return activity;
      },
    );
    if (removedUrl) await this.discard([removedUrl], user.id);
    return toActivityView(result);
  }

  /**
   * Deletes the files of images that are gone (a removed image, activity, day
   * or itinerary). Best effort: the database is already right, so a file that
   * cannot be deleted is logged, never reported to the traveller.
   */
  async discard(urls: string[], ownerId: string): Promise<void> {
    const results = await Promise.allSettled(
      urls.map((url) => this.uploads.remove(url, ownerId)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.error(
        `Could not delete ${failed} of ${urls.length} activity image files`,
      );
    }
  }
}
