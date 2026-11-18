import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CountryDocument = HydratedDocument<Country>;

/**
 * Read-only reference data (GEN-12), loaded by `npm run seed` from
 * `docs/requirements/reference-data/countries.csv`. No endpoint writes it.
 */
@Schema({ collection: 'countries' })
export class Country {
  /** Dataset id (`code` column), e.g. `EG`. Kept exactly as in the dataset. */
  @Prop({ type: String, required: true, unique: true })
  code!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** ISO 4217 currency code, e.g. `EGP`. */
  @Prop({ type: String, required: true })
  currency!: string;
}

export const CountrySchema = SchemaFactory.createForClass(Country);
