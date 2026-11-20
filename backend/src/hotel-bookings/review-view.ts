import type { HotelReviewDocument } from './schemas/hotel-review.schema';

/** Shown instead of the name of a user who deactivated their account (ACC-12). */
export const DELETED_USER = 'Deleted user';

export interface ReviewAuthor {
  /** null for a deactivated account. */
  id: string | null;
  name: string;
}

/** The hotel's response to a review (HTL-26); the moderator is not named. */
export interface ReviewReplyView {
  text: string;
  repliedAt: string;
  editedAt?: string;
}

export interface HotelReviewView {
  id: string;
  reservationId: string;
  hotelId: string;
  rating: number;
  text: string | null;
  author: ReviewAuthor;
  isHidden: boolean;
  /** The hotel's response, or null when the hotel has not answered. */
  reply: ReviewReplyView | null;
  createdAt: string;
  updatedAt: string;
}

export interface RatingSummary {
  /** Average of the visible ratings, one decimal; null when there are none. */
  averageRating: number | null;
  ratingCount: number;
}

export function toReviewView(
  doc: HotelReviewDocument,
  author: ReviewAuthor,
): HotelReviewView {
  return {
    id: doc.id,
    reservationId: doc.reservation.toString(),
    hotelId: doc.hotel.toString(),
    rating: doc.rating,
    text: doc.text ?? null,
    author,
    isHidden: doc.isHidden,
    reply: doc.reply
      ? {
          text: doc.reply.text,
          repliedAt: doc.reply.repliedAt.toISOString(),
          ...(doc.reply.editedAt
            ? { editedAt: doc.reply.editedAt.toISOString() }
            : {}),
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
