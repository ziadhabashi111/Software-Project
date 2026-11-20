import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';

/**
 * Where the official datasets live (PDF 5.1). Resolves to the repository's
 * `docs/requirements/reference-data/` from both `src/` (tests) and `dist/`
 * (`npm run seed`), because both mirror `backend/src/reference-data/`.
 */
export const REFERENCE_DATA_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'requirements',
  'reference-data',
);

export interface CountryRow {
  code: string;
  name: string;
  currency: string;
}

export interface CityRow {
  cityId: string;
  name: string;
  countryCode: string;
}

export interface AirportRow {
  iataCode: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
}

export interface AttractionRow {
  attractionId: string;
  name: string;
  cityId: string;
}

export interface CurrencyRow {
  code: string;
  countryCodes: string[];
}

export interface ReferenceData {
  countries: CountryRow[];
  cities: CityRow[];
  airports: AirportRow[];
  attractions: AttractionRow[];
  currencies: CurrencyRow[];
}

/** The four CSV files' contents, keyed by dataset. */
export interface ReferenceCsv {
  countries: string;
  cities: string;
  airports: string;
  attractions: string;
}

export class ReferenceDataError extends Error {}

const COUNTRY_CODE = /^[A-Z]{2}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const IATA_CODE = /^[A-Z]{3}$/;

export function readReferenceCsv(dir = REFERENCE_DATA_DIR): ReferenceCsv {
  const read = (file: string): string => readFileSync(join(dir, file), 'utf8');
  return {
    countries: read('countries.csv'),
    cities: read('cities.csv'),
    airports: read('airports.csv'),
    attractions: read('attractions.csv'),
  };
}

export function isIanaTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses and checks the official datasets. IDs are only trimmed, never
 * changed, so they match the evaluation records. Any bad row stops the seed
 * with a message naming the file and line.
 */
export function parseReferenceData(csv: ReferenceCsv): ReferenceData {
  const countries = rows(csv.countries, 'countries.csv', [
    'code',
    'name',
    'currency',
  ]).map(({ line, get }) => {
    const row: CountryRow = {
      code: get('code'),
      name: get('name'),
      currency: get('currency'),
    };
    check(
      COUNTRY_CODE.test(row.code),
      'countries.csv',
      line,
      `code "${row.code}" is not a two-letter code`,
    );
    check(
      CURRENCY_CODE.test(row.currency),
      'countries.csv',
      line,
      `currency "${row.currency}" is not a three-letter code`,
    );
    return row;
  });
  unique(
    countries.map((c) => c.code),
    'countries.csv',
    'code',
  );
  const countryCodes = new Set(countries.map((c) => c.code));

  const cities = rows(csv.cities, 'cities.csv', [
    'city_id',
    'name',
    'country_code',
  ]).map(({ line, get }) => {
    const row: CityRow = {
      cityId: get('city_id'),
      name: get('name'),
      countryCode: get('country_code'),
    };
    check(
      countryCodes.has(row.countryCode),
      'cities.csv',
      line,
      `country_code "${row.countryCode}" is not in countries.csv`,
    );
    return row;
  });
  unique(
    cities.map((c) => c.cityId),
    'cities.csv',
    'city_id',
  );
  const cityCountry = new Map(cities.map((c) => [c.cityId, c.countryCode]));

  const airports = rows(csv.airports, 'airports.csv', [
    'iata_code',
    'name',
    'city_id',
    'country_code',
    'time_zone',
  ]).map(({ line, get }) => {
    const row: AirportRow = {
      iataCode: get('iata_code'),
      name: get('name'),
      cityId: get('city_id'),
      countryCode: get('country_code'),
      timeZone: get('time_zone'),
    };
    check(
      IATA_CODE.test(row.iataCode),
      'airports.csv',
      line,
      `iata_code "${row.iataCode}" is not a three-letter code`,
    );
    check(
      cityCountry.has(row.cityId),
      'airports.csv',
      line,
      `city_id "${row.cityId}" is not in cities.csv`,
    );
    check(
      cityCountry.get(row.cityId) === row.countryCode,
      'airports.csv',
      line,
      `country_code "${row.countryCode}" does not match the country of city "${row.cityId}"`,
    );
    check(
      isIanaTimeZone(row.timeZone),
      'airports.csv',
      line,
      `time_zone "${row.timeZone}" is not an IANA time zone`,
    );
    return row;
  });
  unique(
    airports.map((a) => a.iataCode),
    'airports.csv',
    'iata_code',
  );

  const attractions = rows(csv.attractions, 'attractions.csv', [
    'attraction_id',
    'name',
    'city_id',
  ]).map(({ line, get }) => {
    const row: AttractionRow = {
      attractionId: get('attraction_id'),
      name: get('name'),
      cityId: get('city_id'),
    };
    check(
      cityCountry.has(row.cityId),
      'attractions.csv',
      line,
      `city_id "${row.cityId}" is not in cities.csv`,
    );
    return row;
  });
  unique(
    attractions.map((a) => a.attractionId),
    'attractions.csv',
    'attraction_id',
  );

  return {
    countries,
    cities,
    airports,
    attractions,
    currencies: currenciesOf(countries),
  };
}

/** Supported currencies = distinct currency codes of the countries (PDF 5.1). */
export function currenciesOf(countries: CountryRow[]): CurrencyRow[] {
  const byCode = new Map<string, string[]>();
  for (const country of countries) {
    const list = byCode.get(country.currency) ?? [];
    list.push(country.code);
    byCode.set(country.currency, list);
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, countryCodes]) => ({
      code,
      countryCodes: countryCodes.sort(),
    }));
}

interface CsvRow {
  line: number;
  get: (column: string) => string;
}

function rows(text: string, file: string, columns: string[]): CsvRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      bom: true,
      columns: (header: string[]) => header.map((h) => h.trim()),
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    throw new ReferenceDataError(
      `${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (records.length === 0) {
    throw new ReferenceDataError(`${file}: the file has no rows`);
  }
  const missing = columns.filter((column) => !(column in records[0]));
  if (missing.length > 0) {
    throw new ReferenceDataError(
      `${file}: missing column(s) ${missing.join(', ')}`,
    );
  }
  return records.map((record, index) => {
    const line = index + 2; // line 1 is the header
    return {
      line,
      get: (column: string): string => {
        const value = record[column] ?? '';
        check(value !== '', file, line, `${column} is empty`);
        return value;
      },
    };
  });
}

function check(ok: boolean, file: string, line: number, message: string): void {
  if (!ok) throw new ReferenceDataError(`${file} line ${line}: ${message}`);
}

function unique(ids: string[], file: string, column: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ReferenceDataError(`${file}: duplicate ${column} "${id}"`);
    }
    seen.add(id);
  }
}
