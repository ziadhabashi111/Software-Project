import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/booking-status/booking-status';
import { CabinClass } from '../../flights/flight-status';
import { PassengerType } from '../../flights/passenger-rules';
import { PLATFORM_CURRENCY } from '../../payments/platform-currency';
import type { RefundStatus } from '../../payments/refund.service.interface';

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

export const TRIP_TYPES = ['one-way', 'round-trip'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

/**
 * One flight of the booking (`segments[0]` is the outbound). The agreed price
 * and baggage terms are copied at hold time, so later airline edits do not
 * change this booking (FLT-05). Times and airports are read live from the
 * flight, because an airline may move a flight and passengers must see the
 * new times (FLT-05, GEN-06).
 */
@Schema({ _id: false })
export class BookedSegment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true })
  flight!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Airline', required: true })
  airline!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass!: CabinClass;

  /** Cabin fare per adult or child when the seats were held. */
  @Prop({ type: Number, required: true, min: 0 })
  farePerSeat!: number;

  @Prop({ type: Number, required: true, min: 0 })
  freeBags!: number;

  /** Also the weight limit of each extra bag (FLT-08). */
  @Prop({ type: Number, required: true, min: 0 })
  maxBagWeightKg!: number;

  /** 0 when the airline had no baggage policy. */
  @Prop({ type: Number, required: true, min: 0 })
  extraBagPrice!: number;
}
const BookedSegmentSchema = SchemaFactory.createForClass(BookedSegment);

/** A passenger and what they pay over all segments (FLT-19, FLT-12). */
@Schema({ _id: false })
export class BookedPassenger {
  @Prop({ type: String, required: true, trim: true })
  fullName!: string;

  @Prop({ type: Date, required: true })
  dateOfBirth!: Date;

  /** Passport or ID number. */
  @Prop({ type: String, required: true, trim: true })
  documentNumber!: string;

  @Prop({ type: String, enum: Object.values(PassengerType), required: true })
  type!: PassengerType;

  @Prop({ type: Number, default: 0, min: 0 })
  extraBags!: number;

  @Prop({ type: Number, min: 0 })
  extraBagWeightKg?: number;

  /** Sum of this passenger's fares over the segments. */
  @Prop({ type: Number, required: true, min: 0 })
  fare!: number;

  /** Sum of this passenger's extra-bag fees over the segments. */
  @Prop({ type: Number, required: true, min: 0 })
  baggageFee!: number;
}
const BookedPassengerSchema = SchemaFactory.createForClass(BookedPassenger);

@Schema({ _id: false })
export class BookingPrice {
  @Prop({ type: Number, required: true, min: 0 })
  fares!: number;

  @Prop({ type: Number, required: true, min: 0 })
  baggage!: number;

  @Prop({ type: Number, required: true, min: 0 })
  total!: number;

  /** Fares + baggage of each segment, in segment order (refund of one leg). */
  @Prop({ type: [Number], required: true })
  perSegment!: number[];
}
const BookingPriceSchema = SchemaFactory.createForClass(BookingPrice);

/** The airline's tier as accepted at booking time (FLT-09, PAY-02). */
@Schema({ _id: false })
export class BookedCancellationTier {
  @Prop({ type: Number, required: true, min: 0 })
  daysBefore!: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}
const BookedCancellationTierSchema = SchemaFactory.createForClass(
  BookedCancellationTier,
);

@Schema({ _id: false })
export class BookedBaggagePolicy {
  @Prop({ type: Number, required: true, min: 0 })
  extraBagPrice!: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBags!: number;
}
const BookedBaggagePolicySchema =
  SchemaFactory.createForClass(BookedBaggagePolicy);

/** Only the Stripe id, amount, currency and status are kept (PAY-01). */
@Schema({ _id: false })
export class BookingPayment {
  @Prop({ type: String })
  paymentIntentId?: string;

  @Prop({ type: Number, min: 0 })
  amount?: number;

  @Prop({ type: String })
  currency?: string;

  /** `PENDING`, `FAILED` (retry allowed until expiry) or `SUCCEEDED`. */
  @Prop({ type: String })
  status?: string;
}
const BookingPaymentSchema = SchemaFactory.createForClass(BookingPayment);

/** The refund of a cancelled booking (PAY-03). */
@Schema({ _id: false })
export class BookingRefund {
  @Prop({ type: String })
  refundId?: string;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  percent!: number;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  /** Unset when nothing is refunded (0%). */
  @Prop({ type: String })
  status?: RefundStatus;

  /** Why the refund failed, when FAILED. A short code, never a stack/secret. */
  @Prop({ type: String })
  failureReason?: string;
}
const BookingRefundSchema = SchemaFactory.createForClass(BookingRefund);

/** A flight booking (FLT-12, FLT-19, FLT-22, FLT-23, GEN-11). */
@Schema({ timestamps: true })
export class FlightBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: String, enum: TRIP_TYPES, required: true })
  tripType!: TripType;

  @Prop({ type: [BookedSegmentSchema], required: true })
  segments!: BookedSegment[];

  @Prop({ type: [BookedPassengerSchema], required: true })
  passengers!: BookedPassenger[];

  /** Seats taken on each segment: adults + children (infants take none). */
  @Prop({ type: Number, required: true, min: 1 })
  seats!: number;

  @Prop({ type: BookingPriceSchema, required: true })
  price!: BookingPrice;

  @Prop({ type: String, default: PLATFORM_CURRENCY })
  currency!: string;

  /** The outbound airline's tiers; a round trip is cancelled on these (FLT-12). */
  @Prop({ type: [BookedCancellationTierSchema], default: [] })
  cancellationTiers!: BookedCancellationTier[];

  /** The outbound airline's extra-bag rules; absent means no extra bags. */
  @Prop({ type: BookedBaggagePolicySchema })
  baggagePolicy?: BookedBaggagePolicy;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
  })
  status!: BookingStatus;

  @Prop({ type: Date })
  holdExpiresAt?: Date;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  completedAt?: Date;

  @Prop({ type: Date })
  expiredAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: String, enum: ['user', 'airline'] })
  cancelledBy?: 'user' | 'airline';

  /** Set on confirmation (FLT-23). */
  @Prop({ type: String })
  reference?: string;

  @Prop({ type: BookingPaymentSchema })
  payment?: BookingPayment;

  @Prop({ type: BookingRefundSchema })
  refund?: BookingRefund;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// FLT-25: my bookings, newest first.
FlightBookingSchema.index({ user: 1, status: 1, createdAt: -1 });
// FLT-05, FLT-06, FLT-29: bookings of one flight.
FlightBookingSchema.index({ 'segments.flight': 1, status: 1 });
// FLT-22: the expiry sweep.
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// FLT-23: unique once set; unpaid holds have no reference.
FlightBookingSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
