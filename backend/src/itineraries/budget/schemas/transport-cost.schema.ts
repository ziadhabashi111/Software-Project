import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { TransportMode } from '../budget-categories';

export type TransportCostDocument = HydratedDocument<TransportCost>;

/** Intercity transport between two cities on a day (ITN-16). */
@Schema({ timestamps: true, collection: 'transport_costs' })
export class TransportCost {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  itineraryId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TransportMode), required: true })
  mode!: TransportMode;

  /** City ids from the predefined list. */
  @Prop({ type: String, required: true })
  fromCity!: string;

  @Prop({ type: String, required: true })
  toCity!: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);
TransportCostSchema.index({ itineraryId: 1, dayId: 1 });
