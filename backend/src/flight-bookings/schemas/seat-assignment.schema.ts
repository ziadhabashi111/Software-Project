import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { CabinClass } from '../../flights/flight-status';

export type SeatAssignmentDocument = HydratedDocument<SeatAssignment>;

/**
 * FLT-28: the seat one passenger of a booking has on one flight. Kept in its
 * own collection so the unique indexes below make seat picks safe under
 * concurrency: a seat belongs to one passenger, and a passenger has one seat
 * per flight of the booking.
 */
@Schema({
  collection: 'seat_assignments',
  timestamps: { createdAt: true, updatedAt: false },
})
export class SeatAssignment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true })
  flight!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass!: CabinClass;

  /** Upper-case label such as `12C`. */
  @Prop({ type: String, required: true })
  seat!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
  })
  booking!: Types.ObjectId;

  /** 0 for the outbound, 1 for the return flight. */
  @Prop({ type: Number, required: true, min: 0 })
  segmentIndex!: number;

  @Prop({ type: Number, required: true, min: 0 })
  passengerIndex!: number;

  createdAt!: Date;
}

export const SeatAssignmentSchema =
  SchemaFactory.createForClass(SeatAssignment);

// One passenger per seat (409 SEAT_TAKEN when two people pick it at once).
SeatAssignmentSchema.index(
  { flight: 1, cabinClass: 1, seat: 1 },
  { unique: true },
);
// One seat per passenger per flight of the booking.
SeatAssignmentSchema.index(
  { booking: 1, segmentIndex: 1, passengerIndex: 1 },
  { unique: true },
);
