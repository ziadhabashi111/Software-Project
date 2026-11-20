import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/booking-status/booking-status';
import { CabinClass } from '../../flights/flight-status';
import type { RefundStatus } from '../../payments/refund.service.interface';

export type FlightBookingChangeDocument = HydratedDocument<FlightBookingChange>;

/** The new segment's terms, copied when its seats were held (FLT-05). */
@Schema({ _id: false })
export class ChangedSegment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true })
  flight!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Airline', required: true })
  airline!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass!: CabinClass;

  @Prop({ type: Number, required: true, min: 0 })
  farePerSeat!: number;

  @Prop({ type: Number, required: true, min: 0 })
  freeBags!: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxBagWeightKg!: number;

  @Prop({ type: Number, required: true, min: 0 })
  extraBagPrice!: number;
}
const ChangedSegmentSchema = SchemaFactory.createForClass(ChangedSegment);

/** The Stripe payment of a dearer change (PAY-01). */
@Schema({ _id: false })
export class ChangePayment {
  @Prop({ type: String })
  paymentIntentId?: string;

  /** `PENDING`, `FAILED` (retry allowed until expiry) or `SUCCEEDED`. */
  @Prop({ type: String })
  status?: string;
}
const ChangePaymentSchema = SchemaFactory.createForClass(ChangePayment);

/** One refund of a cheaper change, taken from one payment (PAY-03). */
@Schema({ _id: false })
export class ChangeRefundPart {
  @Prop({ type: String, required: true })
  paymentIntentId!: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String })
  refundId?: string;

  @Prop({ type: String })
  status?: RefundStatus;

  @Prop({ type: String })
  failureReason?: string;
}
const ChangeRefundPartSchema = SchemaFactory.createForClass(ChangeRefundPart);

/**
 * FLT-27: one change of a Confirmed booking's segment to another flight of
 * the same airline, route and cabin. A dearer change waits here (seats held)
 * until its difference is paid; a same-fare or cheaper one is stored already
 * Confirmed, as its record.
 */
@Schema({ timestamps: true, collection: 'flight_booking_changes' })
export class FlightBookingChange {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
  })
  booking!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  /** 0 = outbound, 1 = return. */
  @Prop({ type: Number, required: true, min: 0, max: 1 })
  segmentIndex!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true })
  fromFlight!: Types.ObjectId;

  @Prop({ type: ChangedSegmentSchema, required: true })
  segment!: ChangedSegment;

  /** Seats taken (adults + children), as on the booking. */
  @Prop({ type: Number, required: true, min: 1 })
  seats!: number;

  @Prop({ type: Number, required: true, min: 0 })
  previousTotal!: number;

  @Prop({ type: Number, required: true, min: 0 })
  newTotal!: number;

  /** newSegmentTotal - currentSegmentTotal: > 0 to pay, < 0 refunded. */
  @Prop({ type: Number, required: true })
  difference!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  /** Pending Payment (dearer, unpaid), Confirmed (applied) or Expired. */
  @Prop({
    type: String,
    enum: [
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
    ],
    required: true,
  })
  status!: BookingStatus;

  @Prop({ type: Date })
  holdExpiresAt?: Date;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  expiredAt?: Date;

  @Prop({ type: ChangePaymentSchema })
  payment?: ChangePayment;

  @Prop({ type: [ChangeRefundPartSchema], default: undefined })
  refunds?: ChangeRefundPart[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const FlightBookingChangeSchema =
  SchemaFactory.createForClass(FlightBookingChange);

// FLT-27: at most one change per booking waits for payment.
FlightBookingChangeSchema.index(
  { booking: 1 },
  {
    unique: true,
    partialFilterExpression: { status: BookingStatus.PENDING_PAYMENT },
    name: 'one_pending_change_per_booking',
  },
);
// The expiry sweep, and the airline cancelling a flight with held changes.
FlightBookingChangeSchema.index({ status: 1, holdExpiresAt: 1 });
FlightBookingChangeSchema.index({ 'segment.flight': 1, status: 1 });
