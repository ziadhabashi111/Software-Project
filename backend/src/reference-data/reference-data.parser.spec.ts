import {
  currenciesOf,
  isIanaTimeZone,
  parseReferenceData,
  readReferenceCsv,
  ReferenceCsv,
  ReferenceDataError,
} from './reference-data.parser';

const valid: ReferenceCsv = {
  countries:
    'code,name,currency\nEG,Egypt,EGP\nFR,France,EUR\nDE,Germany,EUR\n',
  cities:
    'city_id,name,country_code\ncairo,Cairo,EG\nparis,Paris,FR\nfrankfurt,Frankfurt,DE\n',
  airports:
    'iata_code,name,city_id,country_code,time_zone\nCAI,Cairo International Airport,cairo,EG,Africa/Cairo\n',
  attractions: 'attraction_id,name,city_id\natt-8,Römerberg,frankfurt\n',
};

describe('parseReferenceData (GEN-12)', () => {
  it('maps the dataset columns and keeps ids unchanged', () => {
    const data = parseReferenceData(valid);
    expect(data.countries[0]).toEqual({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    expect(data.cities[2]).toEqual({
      cityId: 'frankfurt',
      name: 'Frankfurt',
      countryCode: 'DE',
    });
    expect(data.airports[0]).toEqual({
      iataCode: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
    expect(data.attractions[0]).toEqual({
      attractionId: 'att-8',
      name: 'Römerberg',
      cityId: 'frankfurt',
    });
  });

  it('derives the supported currencies from the countries (shared codes once)', () => {
    expect(parseReferenceData(valid).currencies).toEqual([
      { code: 'EGP', countryCodes: ['EG'] },
      { code: 'EUR', countryCodes: ['DE', 'FR'] },
    ]);
  });

  it('accepts Windows line endings and a byte-order mark', () => {
    const crlf: ReferenceCsv = {
      ...valid,
      countries:
        '﻿code,name,currency\r\nEG,Egypt,EGP\r\nFR,France,EUR\r\nDE,Germany,EUR\r\n',
    };
    expect(parseReferenceData(crlf).countries.map((c) => c.code)).toEqual([
      'EG',
      'FR',
      'DE',
    ]);
  });

  it.each([
    [
      'an unknown IANA time zone',
      {
        airports:
          'iata_code,name,city_id,country_code,time_zone\nCAI,Cairo,cairo,EG,Mars/Olympus\n',
      },
      /airports\.csv line 2: time_zone "Mars\/Olympus"/,
    ],
    [
      'an airport in an unknown city',
      {
        airports:
          'iata_code,name,city_id,country_code,time_zone\nCAI,Cairo,giza,EG,Africa/Cairo\n',
      },
      /city_id "giza" is not in cities\.csv/,
    ],
    [
      'an airport whose country does not match its city',
      {
        airports:
          'iata_code,name,city_id,country_code,time_zone\nCAI,Cairo,cairo,FR,Africa/Cairo\n',
      },
      /does not match the country of city "cairo"/,
    ],
    [
      'a city in an unknown country',
      { cities: 'city_id,name,country_code\ncairo,Cairo,XX\n' },
      /country_code "XX" is not in countries\.csv/,
    ],
    [
      'a duplicate id',
      {
        attractions:
          'attraction_id,name,city_id\natt-1,A,cairo\natt-1,B,paris\n',
      },
      /duplicate attraction_id "att-1"/,
    ],
    [
      'a missing column',
      { countries: 'code,name\nEG,Egypt\n' },
      /missing column\(s\) currency/,
    ],
    [
      'an empty value',
      { countries: 'code,name,currency\nEG,,EGP\n' },
      /countries\.csv line 2: name is empty/,
    ],
    [
      'an invalid currency code',
      { countries: 'code,name,currency\nEG,Egypt,EG\n' },
      /currency "EG" is not a three-letter code/,
    ],
  ])('rejects %s', (_label, override, message) => {
    const run = (): unknown => parseReferenceData({ ...valid, ...override });
    expect(run).toThrow(ReferenceDataError);
    expect(run).toThrow(message);
  });

  it('parses the official datasets in docs/requirements/reference-data', () => {
    const data = parseReferenceData(readReferenceCsv());
    expect(data.countries).toHaveLength(8);
    expect(data.cities).toHaveLength(8);
    expect(data.airports).toHaveLength(8);
    expect(data.attractions).toHaveLength(8);
    expect(data.currencies.map((c) => c.code)).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);
    expect(data.airports.find((a) => a.iataCode === 'JFK')?.timeZone).toBe(
      'America/New_York',
    );
  });
});

describe('helpers', () => {
  it('isIanaTimeZone', () => {
    expect(isIanaTimeZone('Europe/Berlin')).toBe(true);
    expect(isIanaTimeZone('Not/AZone')).toBe(false);
  });

  it('currenciesOf sorts codes and countries', () => {
    expect(
      currenciesOf([
        { code: 'FR', name: 'France', currency: 'EUR' },
        { code: 'AE', name: 'UAE', currency: 'AED' },
        { code: 'DE', name: 'Germany', currency: 'EUR' },
      ]),
    ).toEqual([
      { code: 'AED', countryCodes: ['AE'] },
      { code: 'EUR', countryCodes: ['DE', 'FR'] },
    ]);
  });
});
