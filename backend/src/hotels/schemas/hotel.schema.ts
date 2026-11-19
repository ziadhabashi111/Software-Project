import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
} from '../../flights/schemas/airline.schema';

export type HotelDocument = HydratedDocument<Hotel>;

/** One photo of a hotel (HTL-01): the URL the upload helper returned. */
@Schema()
export class HotelPhoto {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  url!: string;
}
const HotelPhotoSchema = SchemaFactory.createForClass(HotelPhoto);

/** Standard check-in and check-out times when a moderator has not set them (HTL-09). */
export const DEFAULT_CHECK_IN_TIME = '14:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';

/** A hotel's profile and policies (HTL-01, HTL-09, HTL-10). Rooms live in their own collection. */
@Schema({ timestamps: true })
export class Hotel {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  address!: string;

  /** City id from the predefined city list (GEN-12). */
  @Prop({ type: String, required: true, index: true })
  city!: string;

  /** Country code from the predefined country list (GEN-12). */
  @Prop({ type: String, required: true })
  country!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  /** 1 to 5 stars. */
  @Prop({ type: Number, required: true, min: 1, max: 5 })
  starClass!: number;

  @Prop({ type: [String], default: [] })
  amenities!: string[];

  @Prop({ type: [HotelPhotoSchema], default: [] })
  photos!: HotelPhoto[];

  /** `HH:mm` (HTL-09). */
  @Prop({ type: String, default: DEFAULT_CHECK_IN_TIME })
  checkInTime!: string;

  @Prop({ type: String, default: DEFAULT_CHECK_OUT_TIME })
  checkOutTime!: string;

  /** False hides the hotel from search and blocks booking (ACC-15). */
  @Prop({ type: Boolean, default: true, index: true })
  isActive!: boolean;

  /** Refund tiers (HTL-10), the same rule as for flights (FLT-09). */
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
