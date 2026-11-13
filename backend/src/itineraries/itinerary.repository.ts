import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { assertCanAccess } from '../common/security/ownership';
import {
  Itinerary,
  ItineraryDocument,
  Visibility,
} from './schemas/itinerary.schema';

/** How often a change is retried when another request changed the itinerary first. */
const MAX_ATTEMPTS = 25;

function isVersionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === 'VersionError';
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Database access for itineraries. Business rules live in the services. */
@Injectable()
export class ItineraryRepository {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly model: Model<ItineraryDocument>,
  ) {}

  create(data: {
    owner: string;
    title: string;
    countries: string[];
    startDate: Date;
  }): Promise<ItineraryDocument> {
    return this.model.create({
      ...data,
      owner: new Types.ObjectId(data.owner),
      visibility: Visibility.PRIVATE,
    });
  }

  /** The itinerary, or 404 when it is missing or belongs to someone else (ACC-11). */
  async loadOwned(
    id: string,
    user: Pick<AuthUser, 'id' | 'role'>,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.model.findById(id).exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    assertCanAccess(itinerary.owner, user);
    return itinerary;
  }

  /**
   * Loads the itinerary, applies `change` and saves. Itineraries use
   * optimistic concurrency: if another request saved in between, the change
   * is applied again to the fresh copy, so two requests adding a day at the
   * same time both land and the 60-day limit is checked against the real count.
   */
  async change<T>(
    id: string,
    user: Pick<AuthUser, 'id' | 'role'>,
    change: (itinerary: ItineraryDocument) => T | Promise<T>,
  ): Promise<{ itinerary: ItineraryDocument; result: T }> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const itinerary = await this.loadOwned(id, user);
      const result = await change(itinerary);
      try {
        await itinerary.save();
        return { itinerary, result };
      } catch (error) {
        if (!isVersionConflict(error)) throw error;
        await pause(Math.random() * 15);
      }
    }
    throw new ConflictException(
      'The itinerary is being changed by other requests, please try again',
    );
  }

  findByActivityId(activityId: string): Promise<ItineraryDocument | null> {
    return this.model.findOne({ 'days.activities._id': activityId }).exec();
  }

  async pageForOwner(
    ownerId: string,
    page: { skip: number; limit: number },
  ): Promise<{ items: ItineraryDocument[]; total: number }> {
    const filter = { owner: new Types.ObjectId(ownerId) };
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  deleteById(id: string): Promise<ItineraryDocument | null> {
    return this.model.findByIdAndDelete(id).exec();
  }

  /** GEN-10: an admin hides it; the owner and admins still see it. */
  hideById(id: string): Promise<ItineraryDocument | null> {
    return this.model
      .findByIdAndUpdate(id, { isHidden: true }, { returnDocument: 'after' })
      .exec();
  }
}
