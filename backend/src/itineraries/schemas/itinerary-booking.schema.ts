import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { LinkedBookingType } from '../booking-links';

export type ItineraryBookingDocument = HydratedDocument<ItineraryBooking>;

/**
 * ITN-27: a booking the traveller linked to one day of an itinerary. Only the
 * reference is stored; the booking's reference, status and price are read from
 * the booking module whenever the link is shown, so a booking that is changed
 * or cancelled later is never out of date here.
 */
@Schema({
  collection: 'itinerary_bookings',
  timestamps: { createdAt: true, updatedAt: false },
})
export class ItineraryBooking {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itineraryId!: Types.ObjectId;

  /** The day (inside the itinerary) the booking is planned for. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(LinkedBookingType),
    required: true,
  })
  bookingType!: LinkedBookingType;

  /** The flight booking or hotel reservation id. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;

  createdAt!: Date;
}

export const ItineraryBookingSchema =
  SchemaFactory.createForClass(ItineraryBooking);

// One booking is linked at most once per itinerary, so its cost is never
// counted twice.
ItineraryBookingSchema.index(
  { itineraryId: 1, bookingType: 1, bookingId: 1 },
  { unique: true },
);
