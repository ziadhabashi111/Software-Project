import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AttractionDocument = HydratedDocument<Attraction>;

/**
 * Read-only reference data (PDF 5.1), loaded by `npm run seed` from
 * `docs/requirements/reference-data/attractions.csv`.
 */
@Schema({ collection: 'attractions' })
export class Attraction {
  /** Dataset id (`attraction_id` column), e.g. `att-1`. Kept unchanged. */
  @Prop({ type: String, required: true, unique: true })
  attractionId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, index: true })
  cityId!: string;
}

export const AttractionSchema = SchemaFactory.createForClass(Attraction);
