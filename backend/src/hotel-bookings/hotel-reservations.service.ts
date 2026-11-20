import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import type { ClientSession, Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { PLATFORM_CURRENCY } from '../payments/platform-currency';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelInventoryRegistry } from './hotel-inventory';
import { ReservationStatus } from './reservation-status';
import { HotelReservationView, toReservationView } from './reservation-view';
import {
  HotelReservation,
  HotelReservationDocument,
} from './schemas/hotel-reservation.schema';
import { RoomNight, RoomNightDocument } from './schemas/room-night.schema';
import { SharedServices } from './shared-services';
import {
  HOLD_MINUTES,
  assertGuests,
  assertValidStay,
  nightsOf,
  parseDate,
  priceRooms,
  startOfUtcDay,
} from './stay-rules';

/** How many due holds the expiry job handles per run. */
const EXPIRY_BATCH = 100;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * HTL-16, HTL-18: concurrency-safe hotel reservation holds.
 *
 * A hold stores the reservation and one `RoomNight` per room per night in a
 * single MongoDB transaction. `RoomNight` is unique per (room, night), so if
 * any room is already taken for any night by a Confirmed reservation or an
 * unexpired hold, the whole transaction aborts and nothing is held. Nights of
 * expired holds are released first, so they never block anyone.
 */
@Injectable()
export class HotelReservationsService {
  private readonly logger = new Logger(HotelReservationsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(HotelReservation.name)
    private readonly reservations: Model<HotelReservationDocument>,
    @InjectModel(RoomNight.name)
    private readonly roomNights: Model<RoomNightDocument>,
    private readonly inventory: HotelInventoryRegistry,
    private readonly shared: SharedServices,
  ) {}

  /** `POST /api/hotel-bookings`: hold the rooms for 10 minutes. */
  async hold(
    user: AuthUser,
    dto: CreateHotelBookingDto,
    now: Date = new Date(),
  ): Promise<HotelReservationView> {
    const checkIn = parseDate(dto.checkIn);
    const checkOut = parseDate(dto.checkOut);
    assertValidStay(checkIn, checkOut, now);
    assertGuests(dto.rooms);

    const inventory = this.inventory.get();
    if (!inventory) {
      throw new ServiceUnavailableException(
        'Hotel booking is not available yet: the hotel catalogue is not connected',
      );
    }
    const hotel = await inventory.findHotel(dto.hotelId);
    if (!hotel || !hotel.active) throw new NotFoundException('Hotel not found');

    const roomIds = dto.rooms.map((room) => room.roomId);
    const available = await inventory.findRooms(hotel.id, roomIds, {
      checkIn,
      checkOut,
    });
    const nights = nightsOf(checkIn, checkOut);
    let priced = priceRooms(dto.rooms, available, nights.length);
    const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
    const roomObjectIds = roomIds.map((id) => new Types.ObjectId(id));

    let released: Types.ObjectId[] = [];
    try {
      const reservation = await this.connection.transaction(async (session) => {
        // HTL-06: re-check the rooms after locking them, so a block, an
        // availability change or a deactivation saved meanwhile is seen.
        if (inventory.lockRooms) {
          const locked = await inventory.lockRooms(
            hotel.id,
            roomIds,
            { checkIn, checkOut },
            session,
          );
          priced = priceRooms(dto.rooms, locked, nights.length);
        }
        released = await this.releaseExpiredNights(
          roomObjectIds,
          nights,
          now,
          session,
        );

        const [created] = await this.reservations.create(
          [
            {
              user: new Types.ObjectId(user.id),
              hotel: new Types.ObjectId(hotel.id),
              hotelName: hotel.name,
              cancellationTiers: hotel.cancellationTiers.map((tier) => ({
                daysBefore: tier.daysBefore,
                refundPercent: tier.refundPercent,
              })),
              rooms: priced.rooms.map((room) => ({
                room: new Types.ObjectId(room.roomId),
                name: room.name,
                type: room.type,
                adults: room.adults,
                childrenAges: room.childrenAges,
                pricePerNight: room.pricePerNight,
                subtotal: room.subtotal,
              })),
              checkIn,
              checkOut,
              nights: nights.length,
              totalPrice: priced.total,
              currency: PLATFORM_CURRENCY,
              status: ReservationStatus.PENDING_PAYMENT,
              holdExpiresAt,
            },
          ],
          { session },
        );

        await this.roomNights.insertMany(
          roomObjectIds.flatMap((room) =>
            nights.map((night) => ({
              room,
              night,
              reservation: created._id,
              holdExpiresAt,
            })),
          ),
          { session, ordered: true },
        );
        return created;
      });
      await this.cancelPayments(released);
      return toReservationView(reservation, now);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException({
          message:
            'One or more of the selected rooms are no longer available for these dates. Nothing was reserved.',
          code: 'ROOMS_UNAVAILABLE',
        });
      }
      throw error;
    }
  }

  /**
   * Turns unpaid holds whose 10 minutes are over into Expired and releases
   * their rooms (HTL-18). Runs every 30 seconds; safe to run concurrently.
   */
  @Interval('hotel-hold-expiry', 30_000)
  async expireDueHolds(now: Date = new Date()): Promise<number> {
    const due = await this.reservations
      .find(
        {
          status: ReservationStatus.PENDING_PAYMENT,
          holdExpiresAt: { $lte: now },
        },
        { _id: 1 },
      )
      .limit(EXPIRY_BATCH)
      .lean();

    let expired = 0;
    for (const { _id } of due) {
      try {
        const changed = await this.connection.transaction(async (session) => {
          const result = await this.reservations.updateOne(
            {
              _id,
              status: ReservationStatus.PENDING_PAYMENT,
              holdExpiresAt: { $lte: now },
            },
            {
              $set: { status: ReservationStatus.EXPIRED, expiredAt: now },
            },
            { session },
          );
          if (result.modifiedCount === 0) return false;
          await this.roomNights.deleteMany({ reservation: _id }, { session });
          return true;
        });
        if (changed) {
          expired += 1;
          await this.shared.cancelPendingPayment(_id.toString());
        }
      } catch (error) {
        this.logger.error(
          `Could not expire hotel reservation ${_id.toString()}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return expired;
  }

  /**
   * GEN-11, HTL-23: a Confirmed reservation becomes Completed once its
   * check-out date has passed. Runs every 10 minutes.
   */
  @Interval('hotel-stay-completion', 10 * 60_000)
  async completeFinishedStays(now: Date = new Date()): Promise<number> {
    const result = await this.reservations.updateMany(
      {
        status: ReservationStatus.CONFIRMED,
        checkOut: { $lt: startOfUtcDay(now) },
      },
      { $set: { status: ReservationStatus.COMPLETED, completedAt: now } },
    );
    return result.modifiedCount;
  }

  /** Expired holds can no longer be paid: cancel their PaymentIntents (PAY-01). */
  private async cancelPayments(ids: Types.ObjectId[]): Promise<void> {
    for (const id of ids) {
      await this.shared.cancelPendingPayment(id.toString());
    }
  }

  /**
   * Inside a hold: any night of these rooms still taken by a hold that has
   * already expired is released, and that hold becomes Expired, so only
   * Confirmed reservations and live holds can block the new request.
   */
  private async releaseExpiredNights(
    rooms: Types.ObjectId[],
    nights: Date[],
    now: Date,
    session: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const stale = await this.roomNights
      .find(
        {
          room: { $in: rooms },
          night: { $in: nights },
          holdExpiresAt: { $lte: now },
        },
        { reservation: 1 },
      )
      .session(session)
      .lean();
    if (stale.length === 0) return [];

    const ids = [
      ...new Map(
        stale.map((row) => [row.reservation.toString(), row.reservation]),
      ).values(),
    ];
    // The holds this request expires, so their PaymentIntents get cancelled.
    const expiring = await this.reservations
      .find(
        { _id: { $in: ids }, status: ReservationStatus.PENDING_PAYMENT },
        { _id: 1 },
      )
      .session(session)
      .lean();
    await this.reservations.updateMany(
      { _id: { $in: ids }, status: ReservationStatus.PENDING_PAYMENT },
      { $set: { status: ReservationStatus.EXPIRED, expiredAt: now } },
      { session },
    );
    // Only nights that are still unpaid holds; a confirmed night has no expiry.
    await this.roomNights.deleteMany(
      { reservation: { $in: ids }, holdExpiresAt: { $lte: now } },
      { session },
    );
    return expiring.map((row) => row._id);
  }
}
