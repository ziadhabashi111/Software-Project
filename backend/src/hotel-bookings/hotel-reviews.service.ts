import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import {
  Paginated,
  PaginationQueryDto,
  skipFor,
  toPage,
} from '../common/pagination/pagination';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import {
  CreateReviewDto,
  ReviewReplyDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { HotelInventoryRegistry } from './hotel-inventory';
import { HotelRatings } from './hotel-ratings';
import { ReservationStatus } from './reservation-status';
import { effectiveStatus } from './reservation-view';
import {
  DELETED_USER,
  HotelReviewView,
  RatingSummary,
  ReviewAuthor,
  toReviewView,
} from './review-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import {
  HotelReview,
  HotelReviewDocument,
} from './schemas/hotel-review.schema';
import { SharedServices } from './shared-services';

export type HotelReviewsPage = Paginated<HotelReviewView> & RatingSummary;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/** HTL-23 (write, edit, delete a review) and HTL-24 (a hotel's reviews). */
@Injectable()
export class HotelReviewsService {
  constructor(
    @InjectModel(HotelReview.name)
    private readonly reviews: Model<HotelReviewDocument>,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    private readonly users: UsersService,
    private readonly ratings: HotelRatings,
    private readonly inventory: HotelInventoryRegistry,
    private readonly shared: SharedServices,
  ) {}

  /** One review per Completed reservation, whatever the number of rooms. */
  async create(
    user: AuthUser,
    reservationId: string,
    dto: CreateReviewDto,
    now: Date = new Date(),
  ): Promise<HotelReviewView> {
    const reservation = await this.reservations.findById(reservationId);
    if (!reservation || reservation.user.toString() !== user.id) {
      throw new NotFoundException('Reservation not found');
    }
    if (effectiveStatus(reservation, now) !== ReservationStatus.COMPLETED) {
      throw new ConflictException({
        message: 'You can review a stay only after it is completed',
        code: 'STAY_NOT_COMPLETED',
      });
    }
    try {
      const review = await this.reviews.create({
        reservation: reservation._id,
        hotel: reservation.hotel,
        hotelName: reservation.hotelName,
        user: reservation.user,
        rating: dto.rating,
        ...(dto.text ? { text: dto.text } : {}),
      });
      return toReviewView(review, await this.authorOf(review));
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException({
          message:
            'You already reviewed this stay; edit or delete that review instead',
          code: 'REVIEW_EXISTS',
        });
      }
      throw error;
    }
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateReviewDto,
  ): Promise<HotelReviewView> {
    if (dto.rating === undefined && dto.text === undefined) {
      throw new BadRequestException('Provide a rating or a text to update');
    }
    const review = await this.findOwn(user, id);
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.text !== undefined) review.text = dto.text || undefined;
    await review.save();
    return toReviewView(review, await this.authorOf(review));
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const review = await this.findOwn(user, id);
    await review.deleteOne();
  }

  /**
   * HTL-26: the hotel's own moderator answers a visible review. The first
   * call creates the reply (and tells the author, GEN-01); later calls change
   * its text. Atomic, so two parallel first replies leave one reply. The
   * review's own `updatedAt` (the author's edits) is not touched.
   */
  async reply(
    user: AuthUser,
    id: string,
    dto: ReviewReplyDto,
    now: Date = new Date(),
  ): Promise<HotelReviewView> {
    const review = await this.findVisibleForModerator(user, id);
    const created = await this.reviews.findOneAndUpdate(
      { _id: review._id, isHidden: false, reply: { $exists: false } },
      {
        $set: {
          reply: {
            text: dto.text,
            moderator: new Types.ObjectId(user.id),
            repliedAt: now,
          },
        },
      },
      { returnDocument: 'after', timestamps: false },
    );
    if (created) {
      await this.shared.notify(
        created.user.toString(),
        'REVIEW_REPLIED',
        `${created.hotelName} replied to your review.`,
      );
      return toReviewView(created, await this.authorOf(created));
    }
    const edited = await this.reviews.findOneAndUpdate(
      { _id: review._id, isHidden: false, reply: { $exists: true } },
      {
        $set: {
          'reply.text': dto.text,
          'reply.moderator': new Types.ObjectId(user.id),
          'reply.editedAt': now,
        },
      },
      { returnDocument: 'after', timestamps: false },
    );
    if (!edited) throw new NotFoundException('Review not found');
    return toReviewView(edited, await this.authorOf(edited));
  }

  /** HTL-26: the hotel's own moderator removes the hotel's reply. */
  async removeReply(user: AuthUser, id: string): Promise<void> {
    const review = await this.findVisibleForModerator(user, id);
    const result = await this.reviews.updateOne(
      { _id: review._id, reply: { $exists: true } },
      { $unset: { reply: 1 } },
      { timestamps: false },
    );
    if (result.modifiedCount === 0) {
      throw new NotFoundException('This review has no reply');
    }
  }

  /**
   * HTL-24: average, count and reviews newest first. Hidden reviews are left
   * out except for admins and for the author's own (GEN-10).
   */
  async listForHotel(
    hotelId: string,
    query: PaginationQueryDto,
    viewer?: AuthUser,
  ): Promise<HotelReviewsPage> {
    const inventory = this.inventory.get();
    if (inventory && !(await inventory.findHotel(hotelId))) {
      throw new NotFoundException('Hotel not found');
    }
    const hotel = new Types.ObjectId(hotelId);
    let filter: QueryFilter<HotelReview> = { hotel, isHidden: false };
    if (viewer?.role === Role.ADMIN) {
      filter = { hotel };
    } else if (viewer) {
      filter = {
        hotel,
        $or: [{ isHidden: false }, { user: new Types.ObjectId(viewer.id) }],
      };
    }
    const [docs, total, summary] = await Promise.all([
      this.reviews
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.reviews.countDocuments(filter),
      this.ratings.forHotel(hotelId),
    ]);
    const authors = await this.authorsOf(docs);
    return {
      ...summary,
      ...toPage(
        docs.map((doc) => toReviewView(doc, authors.get(doc.user.toString())!)),
        total,
        query,
      ),
    };
  }

  /** GEN-09: the review being reported, or null for an unknown id. */
  findById(id: string): Promise<HotelReviewDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.reviews.findById(id);
  }

  /** GEN-10: an admin hides a review (stays visible to its author). */
  hideById(id: string): Promise<HotelReviewDocument | null> {
    return this.reviews.findByIdAndUpdate(
      id,
      { isHidden: true },
      { new: true },
    );
  }

  /** GEN-10: an admin makes a hidden review visible again. */
  unhideById(id: string): Promise<HotelReviewDocument | null> {
    return this.reviews.findByIdAndUpdate(
      id,
      { isHidden: false },
      { new: true },
    );
  }

  /** GEN-10: an admin deletes a review. */
  deleteById(id: string): Promise<HotelReviewDocument | null> {
    return this.reviews.findByIdAndDelete(id);
  }

  /**
   * A visible review of the moderator's own hotel. Hidden or unknown reviews
   * are 404 (GEN-10); another hotel's review is 403. The hotel link is the
   * moderator's `providerId` (ACC-13), checked here so this module does not
   * depend on the hotels module.
   */
  private async findVisibleForModerator(
    user: AuthUser,
    id: string,
  ): Promise<HotelReviewDocument> {
    const review = await this.reviews.findById(id);
    if (!review || review.isHidden) {
      throw new NotFoundException('Review not found');
    }
    if (
      user.role !== Role.HOTEL_MODERATOR ||
      user.providerId !== review.hotel.toString()
    ) {
      throw new ForbiddenException(
        'You can only reply to reviews of your own hotel',
      );
    }
    return review;
  }

  private async findOwn(
    user: AuthUser,
    id: string,
  ): Promise<HotelReviewDocument> {
    const review = await this.reviews.findById(id);
    if (!review || review.user.toString() !== user.id) {
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  private async authorOf(review: HotelReviewDocument): Promise<ReviewAuthor> {
    return (await this.authorsOf([review])).get(review.user.toString())!;
  }

  /** Author names; a deactivated (or missing) account shows "Deleted user". */
  private async authorsOf(
    reviews: HotelReviewDocument[],
  ): Promise<Map<string, ReviewAuthor>> {
    const ids = [...new Set(reviews.map((r) => r.user.toString()))];
    const users = new Map(
      (await this.users.findByIds(ids)).map((u) => [u.id, u]),
    );
    return new Map(
      ids.map((id) => {
        const user = users.get(id);
        return [
          id,
          user && user.status !== UserStatus.DEACTIVATED
            ? { id, name: user.name }
            : { id: null, name: DELETED_USER },
        ];
      }),
    );
  }
}
