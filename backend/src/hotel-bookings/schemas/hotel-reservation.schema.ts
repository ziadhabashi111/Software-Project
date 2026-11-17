import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ReservationStatus } from '../reservation-status';

export type HotelReservationDocument = HydratedDocument<HotelReservation>;

/**
 * One room of a reservation with its guests and the price at booking time
 * (HTL-16). Embedded: rooms are bounded and only exist inside the reservation.
 */
@Schema({ _id: false })
export class ReservedRoom {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  /** Snapshot of the room number/name and type, for lists and receipts. */
  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String })
  type?: string;

  @Prop({ type: Number, required: true, min: 0 })
  adults!: number;

  /** Age of each child, 0-17. */
  @Prop({ type: [Number], default: [] })
  childrenAges!: number[];

  /** Price per night when the reservation was made; later edits do not apply. */
  @Prop({ type: Number, required: true, min: 0 })
  pricePerNight!: number;

  /** nights x pricePerNight. */
  @Prop({ type: Number, required: true, min: 0 })
  subtotal!: number;
}
const ReservedRoomSchema = SchemaFactory.createForClass(ReservedRoom);

/** Only the Stripe ids, amount, currency and status are stored (PAY-01). */
@Schema({ _id: false })
export class ReservationPayment {
  @Prop({ type: String })
  stripePaymentIntentId?: string;

  @Prop({ type: String })
  status?: string;

  @Prop({ type: Number })
  amount?: number;

  @Prop({ type: String })
  currency?: string;
}
const ReservationPaymentSchema =
  SchemaFactory.createForClass(ReservationPayment);

@Schema({ _id: false })
export class ReservationRefund {
  @Prop({ type: String })
  stripeRefundId?: string;

  @Prop({ type: Number })
  percentage?: number;

  @Prop({ type: Number })
  amount?: number;

  @Prop({ type: String })
  status?: string;
}
const ReservationRefundSchema = SchemaFactory.createForClass(ReservationRefund);

/**
 * A hotel reservation: one or more rooms of the same hotel for the same
 * dates (HTL-16), held together for 10 minutes as Pending Payment (HTL-18).
 *
 * Which rooms are taken on which nights is kept in `RoomNight` (unique per
 * room and night), so overlapping reservations cannot be stored even under
 * parallel requests.
 */
@Schema({ timestamps: true, collection: 'hotel_reservations' })
export class HotelReservation {
  /** Unique booking reference, assigned on confirmation (HTL-17). */
  @Prop({ type: String })
  reference?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotel!: Types.ObjectId;

  /** Snapshot of the hotel name for lists. */
  @Prop({ type: String, required: true })
  hotelName!: string;

  @Prop({ type: [ReservedRoomSchema], required: true })
  rooms!: ReservedRoom[];

  /** Calendar dates stored as midnight UTC; check-out is the departure day. */
  @Prop({ type: Date, required: true })
  checkIn!: Date;

  @Prop({ type: Date, required: true })
  checkOut!: Date;

  @Prop({ type: Number, required: true, min: 1 })
  nights!: number;

  @Prop({ type: Number, required: true, min: 0 })
  totalPrice!: number;

  /** Always the platform currency (PAY-04). */
  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({
    type: String,
    enum: Object.values(ReservationStatus),
    required: true,
    default: ReservationStatus.PENDING_PAYMENT,
  })
  status!: ReservationStatus;

  /** End of the 10-minute hold while Pending Payment (HTL-18). */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: Date })
  expiredAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: ReservationPaymentSchema })
  payment?: ReservationPayment;

  @Prop({ type: ReservationRefundSchema })
  refund?: ReservationRefund;

  createdAt!: Date;
  updatedAt!: Date;
}

export const HotelReservationSchema =
  SchemaFactory.createForClass(HotelReservation);

HotelReservationSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
// Hold expiry job and status lists.
HotelReservationSchema.index({ status: 1, holdExpiresAt: 1 });
// My reservations and the moderator view (HTL-20, HTL-22).
HotelReservationSchema.index({ user: 1, checkIn: -1 });
HotelReservationSchema.index({ hotel: 1, checkIn: -1 });
// Rooms of a reservation, for HTL-06 checks and HTL-08 room status.
HotelReservationSchema.index({ 'rooms.room': 1, checkIn: 1, checkOut: 1 });
