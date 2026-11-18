import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type HotelReviewDocument = HydratedDocument<HotelReview>;

/**
 * One rating (1-5) and an optional text per Completed reservation, however
 * many rooms it had (HTL-23). Hidden reviews are visible only to their author
 * and admins and do not count towards the hotel's average (GEN-10).
 */
@Schema({ timestamps: true, collection: 'hotel_reviews' })
export class HotelReview {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelReservation',
    required: true,
  })
  reservation!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotel!: Types.ObjectId;

  /** Snapshot of the hotel name, for the admin audit trail. */
  @Prop({ type: String, required: true })
  hotelName!: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ type: String, maxlength: 1000 })
  text?: string;

  @Prop({ type: Boolean, default: false })
  isHidden!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const HotelReviewSchema = SchemaFactory.createForClass(HotelReview);

// One review per reservation (HTL-23), also under parallel requests.
HotelReviewSchema.index({ reservation: 1 }, { unique: true });
// A hotel's reviews newest first, and its average rating (HTL-24).
HotelReviewSchema.index({ hotel: 1, isHidden: 1, createdAt: -1 });
