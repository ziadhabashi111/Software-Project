import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { RatingSummary } from './review-view';
import {
  HotelReview,
  HotelReviewDocument,
} from './schemas/hotel-review.schema';

/**
 * HTL-23, HTL-24: a hotel's average rating and number of ratings, computed
 * from the visible reviews whenever it is asked for, so creating, editing,
 * deleting or hiding a review is reflected at once. Exported for the hotel
 * details page (HTL-02) and the rating filter and sort in search (HTL-12).
 */
@Injectable()
export class HotelRatings {
  constructor(
    @InjectModel(HotelReview.name)
    private readonly reviews: Model<HotelReviewDocument>,
  ) {}

  async forHotel(hotelId: string): Promise<RatingSummary> {
    return (await this.forHotels([hotelId])).get(hotelId)!;
  }

  /** One summary per requested hotel id (unrated hotels included). */
  async forHotels(hotelIds: string[]): Promise<Map<string, RatingSummary>> {
    const valid = hotelIds.filter((id) => Types.ObjectId.isValid(id));
    const rows = await this.reviews.aggregate<{
      _id: Types.ObjectId;
      average: number;
      count: number;
    }>([
      {
        $match: {
          hotel: { $in: valid.map((id) => new Types.ObjectId(id)) },
          isHidden: false,
        },
      },
      {
        $group: {
          _id: '$hotel',
          average: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);
    const found = new Map(rows.map((row) => [row._id.toString(), row]));
    return new Map(
      hotelIds.map((id) => {
        const row = found.get(id);
        return [
          id,
          row
            ? {
                averageRating: Math.round(row.average * 10) / 10,
                ratingCount: row.count,
              }
            : { averageRating: null, ratingCount: 0 },
        ];
      }),
    );
  }
}
