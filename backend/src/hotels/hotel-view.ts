import type { RatingSummary } from '../hotel-bookings/review-view';
import type { HotelDocument } from './schemas/hotel.schema';

/** What the API returns for a hotel (HTL-01, HTL-02, HTL-09, HTL-10). */
export interface HotelView {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  description?: string;
  starClass: number;
  amenities: string[];
  photos: { id: string; url: string }[];
  checkInTime: string;
  checkOutTime: string;
  isActive: boolean;
  /** Longest notice first, the way the refund rule applies it (HTL-10). */
  cancellationPolicy: { daysBefore: number; refundPercent: number }[];
  /** Average of the visible ratings and how many there are (HTL-24). */
  rating: RatingSummary;
}

export function toHotelView(
  hotel: HotelDocument,
  rating: RatingSummary,
): HotelView {
  return {
    id: hotel.id,
    name: hotel.name,
    address: hotel.address,
    city: hotel.city,
    country: hotel.country,
    ...(hotel.description ? { description: hotel.description } : {}),
    starClass: hotel.starClass,
    amenities: hotel.amenities,
    photos: hotel.photos.map((photo) => ({
      id: photo._id.toString(),
      url: photo.url,
    })),
    checkInTime: hotel.checkInTime,
    checkOutTime: hotel.checkOutTime,
    isActive: hotel.isActive,
    cancellationPolicy: [...hotel.cancellationTiers]
      .sort((a, b) => b.daysBefore - a.daysBefore)
      .map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
    rating,
  };
}
