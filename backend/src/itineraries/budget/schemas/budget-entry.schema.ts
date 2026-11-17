import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BudgetCategory } from '../budget-categories';

export type BudgetEntryDocument = HydratedDocument<BudgetEntry>;

/** One budget amount for one day and category, in the currency it was entered in (ITN-14). */
@Schema({ timestamps: true, collection: 'budget_entries' })
export class BudgetEntry {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  itineraryId!: Types.ObjectId;

  /** Id of the day inside the itinerary. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  dayId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BudgetCategory), required: true })
  category!: BudgetCategory;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  /** Three-letter currency code. Converted only when totals are shown (ITN-18). */
  @Prop({ type: String, required: true, uppercase: true })
  currency!: string;

  @Prop({ type: String, maxlength: 200 })
  note?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);
BudgetEntrySchema.index({ itineraryId: 1, dayId: 1 });
