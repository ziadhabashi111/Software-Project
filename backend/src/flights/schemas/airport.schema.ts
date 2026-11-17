import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AirportDocument = HydratedDocument<Airport>;

/**
 * Read-only reference data (FLT-02), loaded by the seed script from
 * `docs/requirements/reference-data/airports.csv`. No endpoint writes it.
 */
@Schema({ collection: 'airports' })
export class Airport {
  @Prop({ type: String, required: true, unique: true, uppercase: true })
  iataCode!: string;

  @Prop({ type: String, required: true })
  name!: string;

  /** Id of the city in the reference data (for example `cairo`). */
  @Prop({ type: String, required: true, index: true })
  cityId!: string;

  @Prop({ type: String, required: true })
  countryCode!: string;

  /** IANA zone used to convert local flight times to and from UTC (GEN-06). */
  @Prop({ type: String, required: true })
  timeZone!: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);
