import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ItineraryDocument = HydratedDocument<Itinerary>;

export enum Visibility {
  PRIVATE = 'private',
  PUBLIC = 'public',
}

/** An uploaded activity image (ITN-12). */
@Schema()
export class ActivityImage {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  url!: string;
}
const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);

@Schema()
export class Activity {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String })
  description?: string;

  /** `HH:mm`, optional. */
  @Prop({ type: String })
  time?: string;

  @Prop({ type: Number, min: 0 })
  cost?: number;

  /** Three-letter currency code of `cost`. */
  @Prop({ type: String })
  currency?: string;

  @Prop({ type: [ActivityImageSchema], default: [] })
  images!: ActivityImage[];
}
const ActivitySchema = SchemaFactory.createForClass(Activity);

/**
 * A day. Its number and date are not stored: they follow from its position
 * in the itinerary and the itinerary start date, so reordering or deleting a
 * day can never leave them out of step (ITN-05, 07, 08).
 */
@Schema()
export class ItineraryDay {
  _id!: Types.ObjectId;

  /** City id from the predefined city list. */
  @Prop({ type: String, required: true })
  city!: string;

  @Prop({ type: String })
  notes?: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities!: Activity[];
}
const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

/** ITN-21: where a cloned itinerary came from, so the original author is credited. */
@Schema({ _id: false })
export class ClonedFrom {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
  })
  itinerary!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  author!: Types.ObjectId;

  /** The author's name when it was cloned, so the credit survives a rename or deactivation. */
  @Prop({ type: String, required: true })
  authorName!: string;
}
const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

/** Days and activities are bounded and owned by the itinerary, so they are embedded. */
@Schema({ timestamps: true, optimisticConcurrency: true })
export class Itinerary {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  owner!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  title!: string;

  /** Country codes from the predefined list. */
  @Prop({ type: [String], default: [] })
  countries!: string[];

  /** A calendar date, midnight UTC. */
  @Prop({ type: Date, required: true })
  startDate!: Date;

  @Prop({
    type: String,
    enum: Object.values(Visibility),
    default: Visibility.PRIVATE,
  })
  visibility!: Visibility;

  /** Set by an admin (GEN-10): visible only to the owner and admins. */
  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  @Prop({ type: [ItineraryDaySchema], default: [] })
  days!: ItineraryDay[];

  /** Set only on a clone (ITN-21). */
  @Prop({ type: ClonedFromSchema })
  clonedFrom?: ClonedFrom;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
ItinerarySchema.index({ owner: 1, updatedAt: -1 });
ItinerarySchema.index({ 'days.activities._id': 1 });
