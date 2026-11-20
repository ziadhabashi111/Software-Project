import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { CabinClass } from '../flights/flight-status';
import {
  SeatAssignment,
  SeatAssignmentDocument,
} from './schemas/seat-assignment.schema';

export interface NewSeatAssignment {
  flight: Types.ObjectId;
  cabinClass: CabinClass;
  seat: string;
  booking: Types.ObjectId;
  segmentIndex: number;
  passengerIndex: number;
}

/** `segmentIndex:passengerIndex` -> seat label, for one booking. */
export type BookingSeats = Map<string, string>;

export const seatKey = (segmentIndex: number, passengerIndex: number) =>
  `${segmentIndex}:${passengerIndex}`;

/**
 * FLT-28: the only code that reads and writes seat assignments. Other booking
 * flows release seats through `releaseBooking` (cancellation, expiry) and
 * `releaseSegment` (FLT-27: a changed flight drops that flight's seats).
 */
@Injectable()
export class SeatAssignments {
  constructor(
    @InjectModel(SeatAssignment.name)
    private readonly model: Model<SeatAssignmentDocument>,
  ) {}

  /** Builds the unique indexes (tests; the app builds them on start). */
  async syncIndexes(): Promise<void> {
    await this.model.syncIndexes();
  }

  /** Seat labels already picked in a cabin of a flight. */
  async takenSeats(
    flightId: string,
    cabinClass: CabinClass,
  ): Promise<string[]> {
    if (!Types.ObjectId.isValid(flightId)) return [];
    const rows = await this.model
      .find({ flight: new Types.ObjectId(flightId), cabinClass })
      .select('seat')
      .lean();
    return rows.map((row) => row.seat);
  }

  /** The seats of several bookings, by booking id. */
  async forBookings(
    bookingIds: Types.ObjectId[],
  ): Promise<Map<string, BookingSeats>> {
    const rows = await this.model
      .find({ booking: { $in: bookingIds } })
      .select('booking segmentIndex passengerIndex seat')
      .lean();
    const byBooking = new Map<string, BookingSeats>();
    for (const row of rows) {
      const id = row.booking.toString();
      const seats = byBooking.get(id) ?? new Map<string, string>();
      seats.set(seatKey(row.segmentIndex, row.passengerIndex), row.seat);
      byBooking.set(id, seats);
    }
    return byBooking;
  }

  /**
   * Gives the passenger this seat, replacing their previous one on that
   * flight. Throws MongoDB's duplicate-key error when someone else holds the
   * seat (the caller turns it into 409 SEAT_TAKEN).
   */
  async assign(
    assignment: NewSeatAssignment,
    session: ClientSession,
  ): Promise<void> {
    await this.model.deleteOne(
      {
        booking: assignment.booking,
        segmentIndex: assignment.segmentIndex,
        passengerIndex: assignment.passengerIndex,
      },
      { session },
    );
    await this.model.create([assignment], { session });
  }

  /** Frees every seat of a booking (cancelled or expired). */
  async releaseBooking(
    bookingId: string | Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const id = toId(bookingId);
    if (!id) return;
    await this.model.deleteMany({ booking: id }, { session });
  }

  /** Frees the seats a booking has on one of its flights (FLT-27 change). */
  async releaseSegment(
    bookingId: string | Types.ObjectId,
    segmentIndex: number,
    session?: ClientSession,
  ): Promise<void> {
    const id = toId(bookingId);
    if (!id) return;
    await this.model.deleteMany({ booking: id, segmentIndex }, { session });
  }
}

function toId(id: string | Types.ObjectId): Types.ObjectId | null {
  if (id instanceof Types.ObjectId) return id;
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}
