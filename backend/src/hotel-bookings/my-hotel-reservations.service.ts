import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter, SortOrder } from 'mongoose';
import { Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import {
  ListHotelBookingsDto,
  ReservationGroup,
} from './dto/list-hotel-bookings.dto';
import { ReservationStatus } from './reservation-status';
import { HotelReservationView, toReservationView } from './reservation-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import { startOfUtcDay } from './stay-rules';

type ReservationFilter = QueryFilter<HotelReservation>;

/**
 * Which reservations fall in each group (HTL-20). It goes by what the user
 * sees now, so it is right even before the background jobs have run.
 */
function groupQuery(
  group: ReservationGroup,
  now: Date,
): { filter: ReservationFilter; sort: Record<string, SortOrder> } {
  const today = startOfUtcDay(now);
  switch (group) {
    case 'upcoming':
      return {
        filter: {
          $or: [
            { status: ReservationStatus.CONFIRMED, checkOut: { $gte: today } },
            {
              status: ReservationStatus.PENDING_PAYMENT,
              holdExpiresAt: { $gt: now },
            },
          ],
        },
        sort: { checkIn: 1, _id: 1 },
      };
    case 'past':
      return {
        filter: {
          $or: [
            {
              status: {
                $in: [ReservationStatus.COMPLETED, ReservationStatus.EXPIRED],
              },
            },
            { status: ReservationStatus.CONFIRMED, checkOut: { $lt: today } },
            {
              status: ReservationStatus.PENDING_PAYMENT,
              holdExpiresAt: { $lte: now },
            },
          ],
        },
        sort: { checkIn: -1, _id: -1 },
      };
    case 'cancelled':
      return {
        filter: { status: ReservationStatus.CANCELLED },
        sort: { cancelledAt: -1, _id: -1 },
      };
  }
}

/** A traveller's own reservations (HTL-20) and reservation details. */
@Injectable()
export class MyHotelReservationsService {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
  ) {}

  async list(
    user: AuthUser,
    query: ListHotelBookingsDto,
    now: Date = new Date(),
  ): Promise<Paginated<HotelReservationView> & { group: ReservationGroup }> {
    const { filter, sort } = groupQuery(query.group, now);
    const mine: ReservationFilter = {
      user: new Types.ObjectId(user.id),
      ...filter,
    };
    const [docs, total] = await Promise.all([
      this.reservations
        .find(mine)
        .sort(sort)
        .skip(skipFor(query))
        .limit(query.limit),
      this.reservations.countDocuments(mine),
    ]);
    return {
      group: query.group,
      ...toPage(
        docs.map((doc) => toReservationView(doc, now)),
        total,
        query,
      ),
    };
  }

  /**
   * Details with payment and refund status. The owner, an admin (ACC-11,
   * ACC-17) and the moderator of that hotel (HTL-22) may see it; anyone else
   * gets 404 so the reservation's existence is not revealed.
   */
  async get(
    user: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<HotelReservationView> {
    const doc = await this.reservations.findById(id);
    if (!doc || !canView(doc, user)) {
      throw new NotFoundException('Reservation not found');
    }
    return toReservationView(doc, now);
  }
}

function canView(doc: HotelReservationDocument, user: AuthUser): boolean {
  if (doc.user.toString() === user.id) return true;
  if (user.role === Role.ADMIN) return true;
  return (
    user.role === Role.HOTEL_MODERATOR &&
    user.providerId !== undefined &&
    doc.hotel.toString() === user.providerId
  );
}
