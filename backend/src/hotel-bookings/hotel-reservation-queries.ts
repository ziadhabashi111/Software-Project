import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { Types } from 'mongoose';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import { ReservationStatus } from './reservation-status';
import { effectiveStatus } from './reservation-view';
import { DELETED_USER } from './review-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import { RoomNight, RoomNightDocument } from './schemas/room-night.schema';
import { formatDate, startOfUtcDay } from './stay-rules';

/** One taken night of one room, for the per-room status view (HTL-08). */
export interface RoomNightActivity {
  roomId: string;
  /** YYYY-MM-DD */
  night: string;
  reservationId: string;
  /** null while the reservation is an unpaid hold. */
  reference: string | null;
  status: ReservationStatus;
}

/** One row of the moderator's reservation list (HTL-22). */
export interface HotelReservationRow {
  id: string;
  reference: string | null;
  guest: { id: string | null; name: string };
  rooms: { roomId: string; name: string; adults: number; children: number }[];
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPrice: number;
  currency: string;
  status: ReservationStatus;
  createdAt: string;
}

/**
 * Read-only reservation facts for the hotels side (Abdelrahman, Noureldin),
 * so they never query the booking collections directly. A room is "taken" for
 * a night by a Confirmed reservation or an unexpired hold (HTL-06, 08, 11,
 * 15); expired holds never count.
 */
@Injectable()
export class HotelReservationQueries {
  constructor(
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNightDocument>,
    private readonly users: UsersService,
  ) {}

  /**
   * HTL-11, HTL-15, HTL-06: which of these rooms are taken on at least one
   * night from `checkIn` up to (not including) `checkOut`.
   */
  async takenRoomIds(
    roomIds: string[],
    checkIn: Date,
    checkOut: Date,
    now: Date = new Date(),
  ): Promise<Set<string>> {
    const rooms = await this.roomNights.distinct('room', {
      room: { $in: toObjectIds(roomIds) },
      night: { $gte: checkIn, $lt: checkOut },
      ...liveNight(now),
    });
    return new Set(rooms.map((room) => room.toString()));
  }

  /** HTL-06: a room with any reservation, of any status, can never be deleted. */
  async wasEverReserved(roomId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(roomId)) return false;
    return (
      (await this.reservations.exists({
        'rooms.room': new Types.ObjectId(roomId),
      })) !== null
    );
  }

  /**
   * ACC-15: the guests with a Confirmed reservation at this hotel that has not
   * ended yet, so they can be told when the hotel is deactivated or restored.
   */
  async confirmedGuestIds(
    hotelId: string,
    now: Date = new Date(),
  ): Promise<string[]> {
    if (!Types.ObjectId.isValid(hotelId)) return [];
    const guests = await this.reservations.distinct('user', {
      hotel: new Types.ObjectId(hotelId),
      status: ReservationStatus.CONFIRMED,
      checkOut: { $gte: startOfUtcDay(now) },
    });
    return guests.map((guest) => guest.toString());
  }

  /**
   * HTL-06: deactivating a room is refused while it is taken tonight or on
   * any later night.
   */
  async hasUpcomingReservations(
    roomId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(roomId)) return false;
    return (
      (await this.roomNights.exists({
        room: new Types.ObjectId(roomId),
        night: { $gte: startOfUtcDay(now) },
        ...liveNight(now),
      })) !== null
    );
  }

  /** HTL-08: every taken night of these rooms in [from, to), with references. */
  async roomActivity(
    roomIds: string[],
    from: Date,
    to: Date,
    now: Date = new Date(),
  ): Promise<RoomNightActivity[]> {
    const nights = await this.roomNights
      .find({
        room: { $in: toObjectIds(roomIds) },
        night: { $gte: from, $lt: to },
        ...liveNight(now),
      })
      .sort({ room: 1, night: 1 })
      .lean();
    const ids = [...new Set(nights.map((n) => n.reservation.toString()))];
    const reservations = new Map(
      (
        await this.reservations.find(
          { _id: { $in: toObjectIds(ids) } },
          { reference: 1, status: 1, holdExpiresAt: 1, checkOut: 1 },
        )
      ).map((doc) => [doc.id, doc]),
    );
    return nights.flatMap((night) => {
      const reservation = reservations.get(night.reservation.toString());
      if (!reservation) return [];
      return [
        {
          roomId: night.room.toString(),
          night: formatDate(night.night),
          reservationId: reservation.id,
          reference: reservation.reference ?? null,
          status: effectiveStatus(reservation, now),
        },
      ];
    });
  }

  /**
   * HTL-22: a hotel's reservations (guest, dates, status), latest check-in
   * first. Call it only after checking the moderator owns `hotelId`.
   */
  async forHotel(
    hotelId: string,
    page: { page: number; limit: number; status?: ReservationStatus },
    now: Date = new Date(),
  ): Promise<Paginated<HotelReservationRow>> {
    if (!Types.ObjectId.isValid(hotelId)) return toPage([], 0, page);
    const filter: QueryFilter<HotelReservation> = {
      hotel: new Types.ObjectId(hotelId),
      ...(page.status ? { status: page.status } : {}),
    };
    const [docs, total] = await Promise.all([
      this.reservations
        .find(filter)
        .sort({ checkIn: -1, _id: -1 })
        .skip(skipFor(page))
        .limit(page.limit),
      this.reservations.countDocuments(filter),
    ]);
    const guests = new Map(
      (
        await this.users.findByIds([
          ...new Set(docs.map((d) => d.user.toString())),
        ])
      ).map((user) => [user.id, user]),
    );
    return toPage(
      docs.map((doc): HotelReservationRow => {
        const userId = doc.user.toString();
        const guest = guests.get(userId);
        return {
          id: doc.id,
          reference: doc.reference ?? null,
          guest:
            guest && guest.status !== UserStatus.DEACTIVATED
              ? { id: userId, name: guest.name }
              : { id: null, name: DELETED_USER },
          rooms: doc.rooms.map((room) => ({
            roomId: room.room.toString(),
            name: room.name,
            adults: room.adults,
            children: room.childrenAges.length,
          })),
          checkIn: formatDate(doc.checkIn),
          checkOut: formatDate(doc.checkOut),
          nights: doc.nights,
          totalPrice: doc.totalPrice,
          currency: doc.currency,
          status: effectiveStatus(doc, now),
          createdAt: doc.createdAt.toISOString(),
        };
      }),
      total,
      page,
    );
  }
}

function toObjectIds(ids: string[]): Types.ObjectId[] {
  return ids
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
}

/** A night still taken: confirmed (no expiry) or a hold not yet expired. */
function liveNight(now: Date): QueryFilter<RoomNight> {
  return {
    $or: [
      { holdExpiresAt: { $exists: false } },
      { holdExpiresAt: { $gt: now } },
    ],
  };
}
