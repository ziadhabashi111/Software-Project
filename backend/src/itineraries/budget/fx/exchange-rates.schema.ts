import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExchangeRatesDocument = HydratedDocument<ExchangeRates>;

/**
 * The last rates fetched from FXRatesAPI (ITN-18). One document per base
 * currency, replaced on every successful fetch, so it is also the fallback
 * when the API is down.
 */
@Schema({ collection: 'exchange_rates' })
export class ExchangeRates {
  @Prop({ type: String, required: true, unique: true, uppercase: true })
  base!: string;

  /** Currency code to units per 1 base. */
  @Prop({ type: Object, required: true })
  rates!: Record<string, number>;

  /** The date the provider says the rates are from (shown to users). */
  @Prop({ type: String, required: true })
  rateDate!: string;

  /** When we fetched them; at most one fetch per day. */
  @Prop({ type: Date, required: true })
  fetchedAt!: Date;
}

export const ExchangeRatesSchema = SchemaFactory.createForClass(ExchangeRates);
