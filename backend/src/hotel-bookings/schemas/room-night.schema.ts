import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RoomNightDocument = HydratedDocument<RoomNight>;

/**
 * One room taken for one night by a Pending Payment or Confirmed reservation.
 *
 * The unique index on (room, night) is what makes overlapping reservations
 * impossible: a hold inserts all its nights in one transaction, and if any
 * of them already exists the whole hold fails and nothing is stored (HTL-18).
 * Nights are released (deleted) when a hold expires or a reservation is
 * cancelled.
 */
@Schema({ collection: 'hotel_room_nights' })
export class RoomNight {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  room!: Types.ObjectId;

  /** The night, as the calendar date (midnight UTC) the guest arrives. */
  @Prop({ type: Date, required: true })
  night!: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelReservation',
    required: true,
    index: true,
  })
  reservation!: Types.ObjectId;

  /**
   * Set while the reservation is an unpaid hold; removed on confirmation.
   * A night whose hold has expired no longer blocks the room.
   */
  @Prop({ type: Date })
  holdExpiresAt?: Date;
}

export const RoomNightSchema = SchemaFactory.createForClass(RoomNight);

RoomNightSchema.index({ room: 1, night: 1 }, { unique: true });
