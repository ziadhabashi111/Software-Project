import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { BookingType, RefundStatus } from '../refund.service.interface';

export const REFUND_STATUSES: RefundStatus[] = [
  'PENDING',
  'FAILED',
  'REFUNDED',
];

/** PAY-03: one refund per cancelled booking; only ids, amount and status. */
@Schema({ timestamps: true })
export class Refund {
  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
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
RefundSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
