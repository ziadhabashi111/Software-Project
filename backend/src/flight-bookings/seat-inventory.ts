import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CabinClass, FlightStatus } from '../flights/flight-status';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';

/**
 * The only code that changes the flights module's seat counters
 * (`cabins[].heldSeats` / `bookedSeats`, "changed only by flight bookings").
 *
 * Every change is one conditional update on the Flight document, so MongoDB
 * serializes it against other holds and against the airline's seat-count
 * edit (FLT-05), which guards `booked + held <= total` the same way. Two
 * requests for the last seat: one matches, the other no longer does (FLT-22).
 * Decrements are guarded too, because `$inc` skips the schema's `min: 0`.
 */
@Injectable()
export class SeatInventory {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
  ) {}

  /**
   * Holds `seats` in the cabin only if the flight is still Scheduled, has not
   * departed and has enough free seats. Locks the airports (`everBooked`,
   * FLT-05). Returns the updated flight (for the current price), or null.
   */
  hold(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
    now: Date,
  ): Promise<FlightDocument | null> {
    return this.flights.findOneAndUpdate(
      {
        _id: flightId,
        status: FlightStatus.SCHEDULED,
        departureUtc: { $gt: now },
        $expr: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: '$cabins',
                  as: 'c',
                  cond: {
                    $and: [
                      { $eq: ['$$c.cabinClass', cabinClass] },
                      {
                        $gte: [
                          {
                            $subtract: [
                              '$$c.totalSeats',
                              { $add: ['$$c.bookedSeats', '$$c.heldSeats'] },
                            ],
                          },
                          seats,
                        ],
                      },
                    ],
                  },
                },
              },
            },
            0,
          ],
        },
      },
      {
        $inc: { 'cabins.$[c].heldSeats': seats },
        $set: { everBooked: true },
      },
      {
        arrayFilters: [{ 'c.cabinClass': cabinClass }],
        returnDocument: 'after',
        session,
      },
    );
  }

  /** A hold ended without payment (expired or the flight was cancelled). */
  async release(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<boolean> {
    return this.change(
      flightId,
      cabinClass,
      { heldSeats: { $gte: seats } },
      { 'cabins.$[c].heldSeats': -seats },
      session,
    );
  }

  /** Payment verified: held seats become booked seats (FLT-23). */
  async confirm(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<boolean> {
    return this.change(
      flightId,
      cabinClass,
      { heldSeats: { $gte: seats } },
      { 'cabins.$[c].heldSeats': -seats, 'cabins.$[c].bookedSeats': seats },
      session,
    );
  }

  /** A confirmed booking was cancelled: its seats return to inventory (FLT-26). */
  async returnBooked(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    seats: number,
    session: ClientSession,
  ): Promise<boolean> {
    return this.change(
      flightId,
      cabinClass,
      { bookedSeats: { $gte: seats } },
      { 'cabins.$[c].bookedSeats': -seats },
      session,
    );
  }

  private async change(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
    guard: Record<string, unknown>,
    inc: Record<string, number>,
    session: ClientSession,
  ): Promise<boolean> {
    const result = await this.flights.updateOne(
      { _id: flightId, cabins: { $elemMatch: { cabinClass, ...guard } } },
      { $inc: inc },
      { arrayFilters: [{ 'c.cabinClass': cabinClass }], session },
    );
    return result.modifiedCount === 1;
  }
}
