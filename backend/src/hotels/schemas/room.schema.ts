import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

/** A run of calendar days, both ends included, midnight UTC. */
@Schema()
export class RoomRange {
  _id!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  from!: Date;

  @Prop({ type: Date, required: true })
  to!: Date;
}
const RoomRangeSchema = SchemaFactory.createForClass(RoomRange);

/**
 * One individually bookable unit of a hotel (HTL-03). Its bookable ranges
 * (HTL-04) and blocked ranges (HTL-06) are embedded: they are few, and saved
 * with optimistic concurrency so two parallel requests can never leave
 * overlapping availability.
 */
@Schema({ timestamps: true, optimisticConcurrency: true })
export class Room {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotel!: Types.ObjectId;

  /** Room number or name, unique within the hotel. */
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, trim: true })
  type?: string;

  @Prop({ type: Number, required: true, min: 1 })
  beds!: number;

  @Prop({ type: Number, required: true, min: 1 })
  maxOccupancy!: number;

  /** In the platform currency (PAY-04). */
  @Prop({ type: Number, required: true, min: 0 })
  pricePerNight!: number;

  /** False excludes the room from search and booking (HTL-06). */
  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  /** When the room can be booked (HTL-04): non-overlapping ranges. */
  @Prop({ type: [RoomRangeSchema], default: [] })
  availability!: RoomRange[];

  /** Nights the moderator took off the market (HTL-06). */
  @Prop({ type: [RoomRangeSchema], default: [] })
  blocked!: RoomRange[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
// HTL-03: the room number or name is unique within its hotel.
RoomSchema.index({ hotel: 1, name: 1 }, { unique: true });
