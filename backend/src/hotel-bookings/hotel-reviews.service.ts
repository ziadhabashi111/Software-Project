import {
  BadRequestException,
  ConflictException,
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
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
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

  /** GEN-10: an admin hides a review (stays visible to its author). */
  hideById(id: string): Promise<HotelReviewDocument | null> {
    return this.reviews.findByIdAndUpdate(
      id,
      { isHidden: true },
      { new: true },
    );
  }

  /** GEN-10: an admin deletes a review. */
  deleteById(id: string): Promise<HotelReviewDocument | null> {
    return this.reviews.findByIdAndDelete(id);
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
