import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CurrencyDocument = HydratedDocument<Currency>;

/**
 * Supported currencies (GEN-12): the distinct currency codes of the countries
 * dataset (PDF 5.1). Derived by `npm run seed`; no endpoint writes it.
 */
@Schema({ collection: 'currencies' })
export class Currency {
  /** ISO 4217 code, e.g. `EUR`. */
  @Prop({ type: String, required: true, unique: true })
  code!: string;

  /** Codes of the countries that use this currency, e.g. `['DE', 'FR']`. */
  @Prop({ type: [String], required: true })
  countryCodes!: string[];
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);
