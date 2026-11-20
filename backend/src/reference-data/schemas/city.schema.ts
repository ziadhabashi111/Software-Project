import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CityDocument = HydratedDocument<City>;

/**
 * Read-only reference data (GEN-12), loaded by `npm run seed` from
 * `docs/requirements/reference-data/cities.csv`. Shared by hotels, airports
 * and itinerary days.
 */
@Schema({ collection: 'cities' })
export class City {
  /** Dataset id (`city_id` column), e.g. `new_york`. Kept unchanged. */
  @Prop({ type: String, required: true, unique: true })
  cityId!: string;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true, index: true })
  countryCode!: string;
}

export const CitySchema = SchemaFactory.createForClass(City);
