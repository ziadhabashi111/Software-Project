import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BOOKING_TYPES } from '../refund.service.interface';
import type { BookingType, RefundStatus } from '../refund.service.interface';

export const REFUND_STATUSES: RefundStatus[] = [
  'PENDING',
  'FAILED',
  'REFUNDED',
];

/**
 * Why money went back:
 * - `cancellation`: the booking was cancelled (tier or airline refund).
 * - `rejected_payment`: a payment the booking could not accept (the hold had
 *   ended, wrong amount, booking no longer payable) was refunded in full.
 * - `fare_difference`: a flight change to a cheaper fare (FLT-27); bookingType
 *   `flight-change`, bookingId = the change.
 * - `cancellation_part`: one payment's share of a cancellation refund, when a
 *   changed booking was paid with several payments (FLT-27).
 */
export const REFUND_KINDS = [
  'cancellation',
  'rejected_payment',
  'fare_difference',
  'cancellation_part',
] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

/** Name of the index before rejected-payment refunds were recorded. */
export const LEGACY_BOOKING_INDEX = 'bookingType_1_bookingId_1';

/**
 * PAY-03: one refund per cancelled booking, plus one per rejected payment;
 * only ids, amount and status.
 */
@Schema({ timestamps: true })
export class Refund {
  /** Records written before `kind` existed are cancellations. */
  @Prop({ type: String, enum: REFUND_KINDS, default: 'cancellation' })
  kind!: RefundKind;

  @Prop({ type: String, enum: BOOKING_TYPES, required: true })
  bookingType!: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  stripePaymentIntentId!: string;

  @Prop({ type: String, required: true, unique: true })
  stripeRefundId!: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: Number, min: 0, max: 100 })
  percentage?: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, enum: REFUND_STATUSES, required: true })
  status!: RefundStatus;

  /** Short Stripe reason code when the refund failed (never a message). */
  @Prop({ type: String })
  failureReason?: string;

  /** Set once the user was told about the final outcome (notify only once). */
  @Prop({ type: Date })
  notifiedAt?: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);
// One cancellation refund per booking; a booking may also have refunds of
// payments it rejected (keyed by their unique stripeRefundId).
RefundSchema.index(
  { bookingType: 1, bookingId: 1, kind: 1 },
  {
    unique: true,
    partialFilterExpression: { kind: 'cancellation' },
    name: 'one_cancellation_refund_per_booking',
  },
);
