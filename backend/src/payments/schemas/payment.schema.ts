import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BOOKING_TYPES } from '../refund.service.interface';
import type { BookingType } from '../refund.service.interface';

@Schema({ timestamps: true })
export class Payment {
  @Prop({ type: String, enum: BOOKING_TYPES, required: true })
  bookingType!: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, index: true })
  stripePaymentIntentId?: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, required: true })
  status!: string;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  /** Set once a rejected payment was refunded, so it is never refunded twice. */
  @Prop({ type: String })
  stripeRefundId?: string;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });
