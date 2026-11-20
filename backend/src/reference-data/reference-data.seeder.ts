import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Airport } from '../flights/schemas/airport.schema';
import {
  parseReferenceData,
  readReferenceCsv,
  type ReferenceData,
} from './reference-data.parser';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';

export interface SeedCounts {
  countries: number;
  cities: number;
  airports: number;
  attractions: number;
  currencies: number;
}

/**
 * GEN-12: loads the official reference datasets into MongoDB.
 *
 * Idempotent: every record is upserted by its dataset id, so running the seed
 * again changes nothing and never creates duplicates. Records are only added
 * or updated, never deleted, so ids other modules already store stay valid.
 */
@Injectable()
export class ReferenceDataSeeder {
  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
  ) {}

  /** Reads the CSVs from `docs/requirements/reference-data/` and seeds them. */
  seedFromFiles(dir?: string): Promise<SeedCounts> {
    return this.seed(parseReferenceData(readReferenceCsv(dir)));
  }

  async seed(data: ReferenceData): Promise<SeedCounts> {
    // Indexes first, so the unique ids are enforced from the very first run.
    // createIndexes only adds missing indexes; it never drops existing ones.
    await Promise.all([
      this.countries.createIndexes(),
      this.cities.createIndexes(),
      this.airports.createIndexes(),
      this.attractions.createIndexes(),
      this.currencies.createIndexes(),
    ]);
    await this.countries.bulkWrite(upserts(data.countries, 'code'));
    await this.cities.bulkWrite(upserts(data.cities, 'cityId'));
    await this.airports.bulkWrite(upserts(data.airports, 'iataCode'));
    await this.attractions.bulkWrite(upserts(data.attractions, 'attractionId'));
    await this.currencies.bulkWrite(upserts(data.currencies, 'code'));
    return {
      countries: data.countries.length,
      cities: data.cities.length,
      airports: data.airports.length,
      attractions: data.attractions.length,
      currencies: data.currencies.length,
    };
  }
}

/**
 * One upsert per record, matched on its dataset id. The parser guarantees
 * every dataset has at least one row, so the batch is never empty.
 */
function upserts<T extends object>(records: T[], key: keyof T & string) {
  return records.map((record) => ({
    updateOne: {
      filter: { [key]: record[key] },
      update: { $set: record },
      upsert: true,
    },
  }));
}
