import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { assertCanAccess } from '../common/security/ownership';
import { UserStatus } from '../users/user-status';
import type { ClonedDay } from './clone-itinerary';
import { buildPublicSearchMatch } from './public-search';
import type { PublicSearchMatch } from './public-search';
import {
  ClonedFrom,
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
  /** Any itinerary by id, without an ownership check (callers decide who may see it). */
  findById(id: string): Promise<ItineraryDocument | null> {
    return Types.ObjectId.isValid(id)
      ? this.model.findById(id).exec()
      : Promise.resolve(null);
  }

  /** ITN-21: stores a private copy for `owner`, crediting the original author. */
  createClone(data: {
    owner: string;
    title: string;
    countries: string[];
    startDate: Date;
    days: ClonedDay[];
    clonedFrom: Pick<ClonedFrom, 'itinerary' | 'author' | 'authorName'>;
  }): Promise<ItineraryDocument> {
    return this.model.create({
      ...data,
      owner: new Types.ObjectId(data.owner),
      visibility: Visibility.PRIVATE,
      isHidden: false,
    });
  }

  /**
   * ITN-21: public itineraries, newest first. The owner must still exist and
   * not be deactivated; hidden itineraries never appear. Pass `authorId` for
   * one author's public itineraries (BLG-12).
   */
  async searchPublic(
    match: PublicSearchMatch,
    page: { skip: number; limit: number },
    authorId?: string,
  ): Promise<{ items: ItineraryDocument[]; total: number }> {
    const [result] = await this.model.aggregate<{
      items: Record<string, unknown>[];
      total: { count: number }[];
    }>([
      {
        $match: {
          ...match,
          ...(authorId ? { owner: new Types.ObjectId(authorId) } : {}),
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'owner',
          foreignField: '_id',
          as: 'ownerAccount',
        },
      },
      {
        $match: {
          'ownerAccount.0': { $exists: true },
          'ownerAccount.status': { $ne: UserStatus.DEACTIVATED },
        },
      },
      { $project: { ownerAccount: 0 } },
      {
        $facet: {
          items: [
            { $sort: { updatedAt: -1, _id: -1 } },
            { $skip: page.skip },
            { $limit: page.limit },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    return {
      items: (result?.items ?? []).map((row) => this.model.hydrate(row)),
      total: result?.total[0]?.count ?? 0,
    };
  }

  /** One author's public itineraries, newest first (BLG-12). */
  publicForAuthor(
    authorId: string,
    page: { skip: number; limit: number },
  ): Promise<{ items: ItineraryDocument[]; total: number }> {
    if (!Types.ObjectId.isValid(authorId)) {
      return Promise.resolve({ items: [], total: 0 });
    }
    return this.searchPublic(
      buildPublicSearchMatch({}, { countryCodes: [], cityIds: [] }),
      page,
      authorId,
    );
  }

  hideById(id: string): Promise<ItineraryDocument | null> {
    return this.model
      .findByIdAndUpdate(id, { isHidden: true }, { returnDocument: 'after' })
      .exec();
  }
}
