import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { CabinClass, FlightStatus } from '../flight-status';

export type FlightDocument = HydratedDocument<Flight>;

/**
 * One cabin category of a flight (FLT-04). Seats are counted three ways so
 * the booking module can hold seats atomically (FLT-22):
 * available = totalSeats - bookedSeats - heldSeats.
 */
@Schema()
export class Cabin {
  _id!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass!: CabinClass;

  @Prop({ type: Number, required: true, min: 1 })
  totalSeats!: number;

  /** Seats of Confirmed bookings. Changed only by flight bookings. */
  @Prop({ type: Number, default: 0, min: 0 })
  bookedSeats!: number;

  /** Seats held by Pending Payment bookings. Changed only by flight bookings. */
  @Prop({ type: Number, default: 0, min: 0 })
  heldSeats!: number;

  /** Fare per adult or child, in the platform currency (PAY-04). */
  @Prop({ type: Number, required: true, min: 0 })
  price!: number;

  /** Free checked bags per passenger. */
  @Prop({ type: Number, required: true, min: 0 })
  freeBags!: number;

  /** Maximum weight per bag in kg; extra bags use the same limit (FLT-08). */
  @Prop({ type: Number, required: true, min: 0 })
  maxBagWeightKg!: number;

  /**
   * Seats per row for the seat map (FLT-28). Unset: 6 in Economy and
   * Premium Economy, 4 in Business and First (`seatsPerRowOf`).
   */
  @Prop({ type: Number, min: 2, max: 10 })
  seatsPerRow?: number;

  /**
   * Bumped by flight bookings whenever a seat is assigned (FLT-28), so a
   * layout change (fewer seats, another seats-per-row) made at the same
   * moment fails and is retried instead of removing an assigned seat.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  seatMapVersion!: number;
}
export const CabinSchema = SchemaFactory.createForClass(Cabin);

@Schema({ timestamps: true })
export class Flight {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Airline',
    required: true,
    index: true,
  })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true, uppercase: true, trim: true })
  flightNumber!: string;

  /** IATA codes from the airport list (FLT-02). */
  @Prop({ type: String, required: true, uppercase: true })
  departureAirport!: string;

  @Prop({ type: String, required: true, uppercase: true })
  arrivalAirport!: string;

  /** Stored in UTC; shown in each airport's local time (GEN-06). */
  @Prop({ type: Date, required: true })
  departureUtc!: Date;

  @Prop({ type: Date, required: true })
  arrivalUtc!: Date;

  /** Local departure date (`YYYY-MM-DD`) at the departure airport: unique with airline and flight number, and the search date (FLT-11). */
  @Prop({ type: String, required: true })
  departureLocalDate!: string;

  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
  })
  status!: FlightStatus;

  @Prop({ type: [CabinSchema], default: [] })
  cabins!: Cabin[];

  /**
   * Set by flight bookings when the first booking or hold is created, and
   * never cleared, so airports stay locked even if every booking is later
   * cancelled (FLT-05).
   */
  @Prop({ type: Boolean, default: false })
  everBooked!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

// FLT-03: one flight number per airline per local departure date.
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);
// FLT-11: the search path.
FlightSchema.index({ departureAirport: 1, arrivalAirport: 1, departureUtc: 1 });
