import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * PAY-01: one row per Stripe webhook event we have handled. The unique index
 * on `eventId` makes the claim atomic, so a redelivered or concurrently
 * delivered event is acknowledged without being processed twice.
 */
@Schema()
export class ProcessedStripeEvent {
  @Prop({ type: String, required: true, unique: true })
  eventId!: string;

  @Prop({ type: String, required: true })
  type!: string;

  /** Stripe retries for up to 3 days; keep the ids well beyond that (30 days). */
  @Prop({ type: Date, default: () => new Date(), expires: 60 * 60 * 24 * 30 })
  processedAt!: Date;
}

export type ProcessedStripeEventDocument =
  HydratedDocument<ProcessedStripeEvent>;
export const ProcessedStripeEventSchema =
  SchemaFactory.createForClass(ProcessedStripeEvent);
