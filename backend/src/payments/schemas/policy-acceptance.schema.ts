import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BOOKING_TYPES } from '../refund.service.interface';
import type { BookingType } from '../refund.service.interface';

@Schema({ timestamps: false })
export class PolicyAcceptance {
  @Prop({ type: String, enum: BOOKING_TYPES, required: true })
  bookingType!: BookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  acceptedAt!: Date;
}

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;
export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);
PolicyAcceptanceSchema.index(
  { bookingType: 1, bookingId: 1 },
  { unique: true },
);
