import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

/** One cancellation tier (FLT-09): the refund share that applies from N days before departure. */
@Schema({ _id: false })
export class CancellationTier {
  /** Whole days before departure from which this tier applies (unique per airline). */
  @Prop({ type: Number, required: true, min: 0 })
  daysBefore!: number;

  /** Refund percentage, 0-100. */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}
export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

/** Extra baggage rules (FLT-08). */
@Schema({ _id: false })
export class BaggagePolicy {
  @Prop({ type: Number, required: true, min: 0 })
  extraBagPrice!: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBags!: number;
}
export const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);

@Schema({ timestamps: true })
export class Airline {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** Airline code such as MS or LH; stored upper-case, unique. */
  @Prop({ type: String, required: true, unique: true, uppercase: true })
  code!: string;

  /** One logo per airline (FLT-01); the uploads helper produces this URL. */
  @Prop({ type: String })
  logoUrl?: string;

  /** False hides the airline from search and blocks booking (ACC-15). */
  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: BaggagePolicySchema })
  baggagePolicy?: BaggagePolicy;

  /** Empty means no tier applies, so cancellations refund 0% (FLT-09). */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationPolicy!: CancellationTier[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
