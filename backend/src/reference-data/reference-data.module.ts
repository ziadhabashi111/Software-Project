import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightsModule } from '../flights/flights.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import {
  CURRENCY_CATALOG,
  type CurrencyCatalog,
} from '../users/currency-catalog';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataSeeder } from './reference-data.seeder';
import { ReferenceDataService } from './reference-data.service';
import { Attraction, AttractionSchema } from './schemas/attraction.schema';
import { City, CitySchema } from './schemas/city.schema';
import { Country, CountrySchema } from './schemas/country.schema';
import { Currency, CurrencySchema } from './schemas/currency.schema';

/**
 * Owner: Ahmed Ismail
 * Requirements: GEN-12 (and the reference lists used by FLT-02, HTL-01,
 * ITN-01, ITN-05)
 *
 * Seeds the official reference datasets (`npm run seed`) and serves the
 * country, city and currency lists. Airports keep Youssef's schema and
 * `GET /api/airports` (FlightsModule); this module only fills them.
 * Inject `ReferenceDataService` to check `isCountry`, `isCity`, `isCurrency`.
 *
 * Global so the users module's `CURRENCY_CATALOG` hook (ACC-09 preferred
 * currency) resolves without UsersModule importing this module, which would
 * be circular (reference-data -> itineraries -> users).
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Attraction.name, schema: AttractionSchema },
      { name: Currency.name, schema: CurrencySchema },
    ]),
    FlightsModule,
    ItinerariesModule,
  ],
  controllers: [ReferenceDataController],
  providers: [
    ReferenceDataService,
    ReferenceDataSeeder,
    {
      provide: CURRENCY_CATALOG,
      inject: [ReferenceDataService],
      useFactory: (referenceData: ReferenceDataService): CurrencyCatalog => ({
        isSupported: (code) => referenceData.isCurrency(code),
      }),
    },
  ],
  exports: [ReferenceDataService, MongooseModule, CURRENCY_CATALOG],
})
export class ReferenceDataModule {}
