import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import {
  DEFAULT_PAGE_SIZE,
  skipFor,
  toPage,
} from '../common/pagination/pagination';
import type { Paginated } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import { HotelReservationQueries } from '../hotel-bookings/hotel-reservation-queries';
import { formatDate } from '../hotel-bookings/stay-rules';
import type { CreateRoomDto, UpdateRoomDto } from './dto/create-room.dto';
import type {
  DateRangeDto,
  ReplaceAvailabilityDto,
} from './dto/date-range.dto';
import {
  assertNoOverlap,
  nightsOfRanges,
  parseRange,
  removedNights,
} from './date-ranges';
import type { DayRange } from './date-ranges';
import { assertOwnHotel } from './hotel-access';
import { nightStatus } from './room-status';
import type { NightInfo } from './room-status';
import { toRoomView } from './room-view';
import type { RoomView } from './room-view';
import { Hotel } from './schemas/hotel.schema';
import { Room } from './schemas/room.schema';
import type { RoomDocument } from './schemas/room.schema';

type Caller = Pick<AuthUser, 'id' | 'role' | 'providerId'>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How often a change is retried when another request changed the room first. */
const MAX_ATTEMPTS = 25;
/** The longest period the availability view shows (rooms x nights stays readable). */
export const MAX_VIEW_NIGHTS = 62;

export interface RoomNightView extends NightInfo {
  /** `YYYY-MM-DD` */
  date: string;
}

/** HTL-08: the hotel's rooms (one page of them), night by night, for a chosen period. */
export interface AvailabilityView {
  hotelId: string;
  from: string;
  to: string;
  rooms: { roomId: string; name: string; nights: RoomNightView[] }[];
  /** All rooms of the hotel; `rooms` holds page `page` of `limit` (GEN-05). */
  total: number;
  page: number;
  limit: number;
}

type PageQuery = { page: number; limit: number };

const dayAfter = (day: Date): Date => new Date(day.getTime() + MS_PER_DAY);

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

function isVersionConflict(error: unknown): boolean {
  return error instanceof Error && error.name === 'VersionError';
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * A hotel's rooms (HTL-03..06, HTL-08), managed only by the hotel's own
 * moderator. Whether a night is taken is always asked of the booking module
 * (`HotelReservationQueries`), never read from its collections.
 */
@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly reservations: HotelReservationQueries,
  ) {}

  /** HTL-03: a room with a number or name that is unique within the hotel. */
  async create(
    user: Caller,
    hotelId: string,
    dto: CreateRoomDto,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    if (!(await this.hotels.exists({ _id: hotelId }))) {
      throw new NotFoundException('Hotel not found');
    }
    try {
      const room = await this.rooms.create({
        hotel: new Types.ObjectId(hotelId),
        name: dto.name,
        ...(dto.type ? { type: dto.type } : {}),
        beds: dto.beds,
        maxOccupancy: dto.maxOccupancy,
        pricePerNight: dto.pricePerNight,
      });
      return toRoomView(room);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw fieldError(
          'name',
          'This hotel already has a room with this number or name',
          409,
        );
      }
      throw error;
    }
  }

  /** HTL-03: the hotel's rooms by number or name, 10 per page (GEN-05). */
  async list(
    user: Caller,
    hotelId: string,
    query: PageQuery,
  ): Promise<Paginated<RoomView>> {
    assertOwnHotel(user, hotelId);
    const { rooms, total } = await this.roomsPage(hotelId, query);
    return toPage(rooms.map(toRoomView), total, query);
  }

  /** HTL-05: beds, occupancy, price and type. Reservations keep the price they were made at. */
  async update(
    user: Caller,
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const changes = defined(dto);
    if (Object.keys(changes).length === 0) {
      throw fieldError('body', 'Send at least one field to change');
    }
    const room =
      Types.ObjectId.isValid(roomId) && Types.ObjectId.isValid(hotelId)
        ? await this.rooms.findOneAndUpdate(
            { _id: roomId, hotel: hotelId },
            { $set: changes },
            { returnDocument: 'after', runValidators: true },
          )
        : null;
    if (!room) throw new NotFoundException('Room not found');
    return toRoomView(room);
  }

  /** HTL-04: a range when the room can be booked; ranges of one room never overlap. */
  async addAvailability(
    user: Caller,
    hotelId: string,
    roomId: string,
    dto: DateRangeDto,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const range = parseRange(dto.from, dto.to);
    const { room } = await this.change(hotelId, roomId, (doc) => {
      assertNoOverlap(doc.availability, range);
      doc.availability.push({ _id: new Types.ObjectId(), ...range });
    });
    return toRoomView(room);
  }

  /**
   * HTL-05: move or resize a range. It can never give up a night that a
   * reservation (Confirmed or a live hold) holds.
   */
  async updateAvailability(
    user: Caller,
    hotelId: string,
    roomId: string,
    rangeId: string,
    dto: DateRangeDto,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const range = parseRange(dto.from, dto.to);
    const { room } = await this.change(hotelId, roomId, async (doc) => {
      const index = this.indexOfRange(doc.availability, rangeId);
      assertNoOverlap(doc.availability, range, index);
      const after = doc.availability.map((existing, i) =>
        i === index ? range : existing,
      );
      await this.assertNightsFree(
        doc.id,
        removedNights(doc.availability, after),
      );
      doc.availability[index].from = range.from;
      doc.availability[index].to = range.to;
    });
    return toRoomView(room);
  }

  /**
   * HTL-05: replaces every bookable range at once. The new ranges must not
   * overlap, and no night a Confirmed reservation or a live hold holds may be
   * left out (409 AVAILABILITY_IN_USE).
   */
  async replaceAvailability(
    user: Caller,
    hotelId: string,
    roomId: string,
    dto: ReplaceAvailabilityDto,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const accepted: DayRange[] = [];
    for (const input of dto.ranges) {
      const range = parseRange(input.from, input.to);
      assertNoOverlap(accepted, range);
      accepted.push(range);
    }
    accepted.sort((a, b) => a.from.getTime() - b.from.getTime());
    const { room } = await this.change(hotelId, roomId, async (doc) => {
      await this.assertNightsFree(
        doc.id,
        removedNights(doc.availability, accepted),
      );
      doc.set('availability', accepted);
    });
    return toRoomView(room);
  }

  /** HTL-05: remove a range, unless a reservation holds one of its nights. */
  async removeAvailability(
    user: Caller,
    hotelId: string,
    roomId: string,
    rangeId: string,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const { room } = await this.change(hotelId, roomId, async (doc) => {
      const index = this.indexOfRange(doc.availability, rangeId);
      const after = doc.availability.filter((_, i) => i !== index);
      await this.assertNightsFree(
        doc.id,
        removedNights(doc.availability, after),
      );
      doc.availability.splice(index, 1);
    });
    return toRoomView(room);
  }

  /** HTL-06: block a range, unless a Confirmed reservation or a live hold overlaps it. */
  async block(
    user: Caller,
    hotelId: string,
    roomId: string,
    dto: DateRangeDto,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const range = parseRange(dto.from, dto.to);
    const { room } = await this.change(hotelId, roomId, async (doc) => {
      assertNoOverlap(doc.blocked, range);
      const taken = await this.reservations.takenRoomIds(
        [doc.id],
        range.from,
        dayAfter(range.to),
      );
      if (taken.has(doc.id)) {
        throw conflict(
          'ROOM_RESERVED',
          'A reservation overlaps these dates, so they cannot be blocked',
        );
      }
      doc.blocked.push({ _id: new Types.ObjectId(), ...range });
    });
    return toRoomView(room);
  }

  /** HTL-06: put a blocked range back on the market. */
  async unblock(
    user: Caller,
    hotelId: string,
    roomId: string,
    blockId: string,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const { room } = await this.change(hotelId, roomId, (doc) => {
      doc.blocked.splice(this.indexOfRange(doc.blocked, blockId), 1);
    });
    return toRoomView(room);
  }

  /** HTL-06: deactivate (refused while the room is taken tonight or later) or reactivate. */
  async setActive(
    user: Caller,
    hotelId: string,
    roomId: string,
    active: boolean,
  ): Promise<RoomView> {
    assertOwnHotel(user, hotelId);
    const { room } = await this.change(hotelId, roomId, async (doc) => {
      if (doc.isActive === active) return;
      if (
        !active &&
        (await this.reservations.hasUpcomingReservations(doc.id))
      ) {
        throw conflict(
          'ROOM_RESERVED',
          'The room has reservations from tonight on, so it cannot be deactivated',
        );
      }
      doc.isActive = active;
    });
    return toRoomView(room);
  }

  /** HTL-06: delete a room, but only one that has never been reserved. */
  async remove(user: Caller, hotelId: string, roomId: string): Promise<void> {
    assertOwnHotel(user, hotelId);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const room = await this.load(hotelId, roomId);
      if (await this.reservations.wasEverReserved(room.id)) {
        throw conflict(
          'ROOM_HAS_RESERVATIONS',
          'A room that has ever been reserved cannot be deleted; deactivate it instead',
        );
      }
      // Versioned: a hold locks the room (HotelCatalog.lockRooms) by bumping
      // its version, so a hold made after the check above stops the delete.
      const { deletedCount } = await this.rooms.deleteOne({
        _id: room._id,
        __v: room.__v,
      });
      if (deletedCount === 1) return;
      await pause(Math.random() * 15);
    }
    throw new ConflictException(
      'The room is being changed by other requests, please try again',
    );
  }

  /** HTL-08: each room, night by night: Available, Booked (with the reference) or Blocked. */
  async availabilityView(
    user: Caller,
    hotelId: string,
    period: { from: string; to: string } & Partial<PageQuery>,
  ): Promise<AvailabilityView> {
    assertOwnHotel(user, hotelId);
    const range = parseRange(period.from, period.to);
    const nights = nightsOfRanges([range]);
    if (nights.length > MAX_VIEW_NIGHTS) {
      throw fieldError(
        'to',
        `Choose a period of at most ${MAX_VIEW_NIGHTS} days`,
      );
    }
    const page = {
      page: period.page ?? 1,
      limit: period.limit ?? DEFAULT_PAGE_SIZE,
    };
    const { rooms, total } = await this.roomsPage(hotelId, page);
    const activity =
      rooms.length > 0
        ? await this.reservations.roomActivity(
            rooms.map((room) => room.id),
            range.from,
            dayAfter(range.to),
          )
        : [];
    const booked = new Map(
      activity.map((entry) => [`${entry.roomId}|${entry.night}`, entry]),
    );
    return {
      hotelId,
      from: formatDate(range.from),
      to: formatDate(range.to),
      rooms: rooms.map((room) => ({
        roomId: room.id,
        name: room.name,
        nights: nights.map((night) => {
          const date = formatDate(night);
          const booking = booked.get(`${room.id}|${date}`);
          return {
            date,
            ...nightStatus(
              room,
              night,
              booking && {
                reservationId: booking.reservationId,
                reference: booking.reference,
              },
            ),
          };
        }),
      })),
      total,
      page: page.page,
      limit: page.limit,
    };
  }

  // helpers -------------------------------------------------------------

  private async roomsPage(
    hotelId: string,
    query: PageQuery,
  ): Promise<{ rooms: RoomDocument[]; total: number }> {
    const filter = { hotel: new Types.ObjectId(hotelId) };
    const [rooms, total] = await Promise.all([
      this.rooms
        .find(filter)
        .sort({ name: 1, _id: 1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.rooms.countDocuments(filter),
    ]);
    return { rooms, total };
  }

  private async load(hotelId: string, roomId: string): Promise<RoomDocument> {
    const room =
      Types.ObjectId.isValid(roomId) && Types.ObjectId.isValid(hotelId)
        ? await this.rooms.findOne({ _id: roomId, hotel: hotelId })
        : null;
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  /**
   * Loads the room, applies the change and saves it. Rooms are saved with
   * optimistic concurrency, so when another request got there first this
   * starts again from the new state: two parallel requests can never both
   * add overlapping ranges.
   */
  private async change<T>(
    hotelId: string,
    roomId: string,
    apply: (room: RoomDocument) => T | Promise<T>,
  ): Promise<{ room: RoomDocument; result: T }> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const room = await this.load(hotelId, roomId);
      const result = await apply(room);
      try {
        await room.save();
        return { room, result };
      } catch (error) {
        if (!isVersionConflict(error)) throw error;
        await pause(Math.random() * 15);
      }
    }
    throw new ConflictException(
      'The room is being changed by other requests, please try again',
    );
  }

  private indexOfRange(
    ranges: { _id: Types.ObjectId }[],
    rangeId: string,
  ): number {
    const index = ranges.findIndex((range) => range._id.toString() === rangeId);
    if (index === -1) throw new NotFoundException('Date range not found');
    return index;
  }

  /** HTL-05: none of these nights may hold a Confirmed reservation or a live hold. */
  private async assertNightsFree(
    roomId: string,
    nights: Date[],
  ): Promise<void> {
    if (nights.length === 0) return;
    const activity = await this.reservations.roomActivity(
      [roomId],
      nights[0],
      dayAfter(nights[nights.length - 1]),
    );
    const removed = new Set(nights.map(formatDate));
    const clash = activity.find(
      (entry) => entry.roomId === roomId && removed.has(entry.night),
    );
    if (clash) {
      throw conflict(
        'AVAILABILITY_IN_USE',
        `A reservation holds ${clash.night}, so that night cannot be taken out of the availability`,
      );
    }
  }
}

export type { DayRange };
