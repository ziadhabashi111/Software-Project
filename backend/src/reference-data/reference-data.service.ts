import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { PlaceCatalog } from '../itineraries/places';
import type {
  ListCitiesQueryDto,
  ListCountriesQueryDto,
  ListCurrenciesQueryDto,
} from './dto/list-reference.dto';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';

export interface CountryView {
  code: string;
  name: string;
  currency: string;
}

export interface CityView {
  cityId: string;
  name: string;
  countryCode: string;
}

export interface CurrencyView {
  code: string;
  countryCodes: string[];
}

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GEN-12: the predefined country, city and currency lists.
 *
 * Other modules use `isCountry`, `isCity` and `isCurrency` to accept only
 * listed values. On start-up it registers itself with the itinerary module's
 * `PlaceCatalog`, so ITN-01 and ITN-05 check against the real lists.
 */
@Injectable()
export class ReferenceDataService implements OnModuleInit {
  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
    private readonly places: PlaceCatalog,
  ) {}

  onModuleInit(): void {
    this.places.register({
      isCountry: (code) => this.isCountry(code),
      isCity: (id) => this.isCity(id),
    });
  }

  async listCountries(
    query: ListCountriesQueryDto,
  ): Promise<Paginated<CountryView>> {
    const filter: QueryFilter<Country> = {};
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ code: pattern }, { name: pattern }];
    }
    const [items, total] = await Promise.all([
      this.countries
        .find(filter)
        .sort({ name: 1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.countries.countDocuments(filter),
    ]);
    return toPage(
      items.map((c) => ({ code: c.code, name: c.name, currency: c.currency })),
      total,
      query,
    );
  }

  async listCities(query: ListCitiesQueryDto): Promise<Paginated<CityView>> {
    const filter: QueryFilter<City> = {};
    if (query.countryCode) filter.countryCode = query.countryCode;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ cityId: pattern }, { name: pattern }];
    }
    const [items, total] = await Promise.all([
      this.cities
        .find(filter)
        .sort({ name: 1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.cities.countDocuments(filter),
    ]);
    return toPage(
      items.map((c) => ({
        cityId: c.cityId,
        name: c.name,
        countryCode: c.countryCode,
      })),
      total,
      query,
    );
  }

  async listCurrencies(
    query: ListCurrenciesQueryDto,
  ): Promise<Paginated<CurrencyView>> {
    const [items, total] = await Promise.all([
      this.currencies
        .find()
        .sort({ code: 1 })
        .skip(skipFor(query))
        .limit(query.limit),
      this.currencies.countDocuments(),
    ]);
    return toPage(
      items.map((c) => ({ code: c.code, countryCodes: c.countryCodes })),
      total,
      query,
    );
  }

  async isCountry(code: string): Promise<boolean> {
    return (await this.countries.exists({ code })) !== null;
  }

  async isCity(cityId: string): Promise<boolean> {
    return (await this.cities.exists({ cityId })) !== null;
  }

  /** For modules that accept a currency (e.g. preferred currency, ACC-09). */
  async isCurrency(code: string): Promise<boolean> {
    return (await this.currencies.exists({ code })) !== null;
  }
}
