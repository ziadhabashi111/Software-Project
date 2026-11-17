import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import { BookingSources } from '../admin/booking-sources';
import type {
  AdminBookingQuery,
  AdminBookingRecord,
  BookingSource,
} from '../admin/booking-sources';
import { DeactivationBlockers } from '../users/deactivation-blockers';
import type { DeactivationBlocker } from '../users/deactivation-blockers';
import { ReservationStatus } from './reservation-status';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import { startOfUtcDay } from './stay-rules';

/**
 * The admin filter may say "Confirmed", "Pending Payment", "CONFIRMED" or
 * "pending_payment"; all mean the same stored status. Unknown -> null.
 */
export function parseStatus(value: string): ReservationStatus | null {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (Object.values(ReservationStatus) as string[]).includes(key)
    ? (key as ReservationStatus)
    : null;
}

/**
 * Plugs hotel reservations into Habashi's account and admin modules:
 * ACC-12 (no deactivation with an upcoming Confirmed stay) and ACC-17 (the
 * admin's read-only booking list).
 */
@Injectable()
export class HotelBookingHooks
  implements DeactivationBlocker, BookingSource, OnModuleInit
{
  readonly type = 'hotel' as const;

  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    private readonly blockers: DeactivationBlockers,
    private readonly sources: BookingSources,
  ) {}

  onModuleInit(): void {
    this.blockers.register(this);
    this.sources.register(this);
  }

  /**
   * ACC-12: a Confirmed stay that has not ended yet (check-out today or
   * later, so a stay in progress counts too).
   */
  async hasUpcomingConfirmedBookings(
    userId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    return (
      (await this.reservations.exists({
        user: new Types.ObjectId(userId),
        status: ReservationStatus.CONFIRMED,
        checkOut: { $gte: startOfUtcDay(now) },
      })) !== null
    );
  }

  /** ACC-17: newest first, filtered by status and check-in date range. */
  async find(
    query: AdminBookingQuery,
  ): Promise<{ items: AdminBookingRecord[]; total: number }> {
    const filter: QueryFilter<HotelReservation> = {};
    if (query.status !== undefined) {
      const status = parseStatus(query.status);
      if (!status) return { items: [], total: 0 };
      filter.status = status;
    }
    if (query.from || query.to) {
      filter.checkIn = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }
    const [docs, total] = await Promise.all([
      this.reservations
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(query.skip)
        .limit(query.limit),
      this.reservations.countDocuments(filter),
    ]);
    return {
      items: docs.map((doc): AdminBookingRecord => ({
        id: doc.id,
        // Unpaid holds have no reference yet (HTL-17).
        reference: doc.reference ?? '',
        type: 'hotel',
        userId: doc.user.toString(),
        provider: { id: doc.hotel.toString(), name: doc.hotelName },
        startDate: doc.checkIn,
        endDate: doc.checkOut,
        amount: doc.totalPrice,
        currency: doc.currency,
        status: doc.status,
        createdAt: doc.createdAt,
      })),
      total,
    };
  }
}
