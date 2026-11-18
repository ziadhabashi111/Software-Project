import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Airport } from '../src/flights/schemas/airport.schema';
import { PlaceCatalog } from '../src/itineraries/places';
import { ReferenceDataModule } from '../src/reference-data/reference-data.module';
import { ReferenceDataSeeder } from '../src/reference-data/reference-data.seeder';
import type { Paginated } from '../src/common/pagination/pagination';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import type {
  CountryView,
  CurrencyView,
} from '../src/reference-data/reference-data.service';
import { Attraction } from '../src/reference-data/schemas/attraction.schema';
import { City } from '../src/reference-data/schemas/city.schema';
import { Country } from '../src/reference-data/schemas/country.schema';
import { Currency } from '../src/reference-data/schemas/currency.schema';
import { PasswordService } from '../src/auth/password.service';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

describe('Reference data seed and lists (GEN-12, real MongoDB in memory)', () => {
  let ctx: TestApp;
  let seeder: ReferenceDataSeeder;
  let countries: Model<Country>;
  let cities: Model<City>;
  let airports: Model<Airport>;
  let attractions: Model<Attraction>;
  let currencies: Model<Currency>;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, ReferenceDataModule],
    });
    seeder = ctx.moduleRef.get(ReferenceDataSeeder);
    countries = ctx.moduleRef.get(getModelToken(Country.name));
    cities = ctx.moduleRef.get(getModelToken(City.name));
    airports = ctx.moduleRef.get(getModelToken(Airport.name));
    attractions = ctx.moduleRef.get(getModelToken(Attraction.name));
    currencies = ctx.moduleRef.get(getModelToken(Currency.name));
    await seeder.seedFromFiles();
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('loads every official dataset with its ids unchanged', async () => {
    expect(await countries.countDocuments()).toBe(8);
    expect(await cities.countDocuments()).toBe(8);
    expect(await airports.countDocuments()).toBe(8);
    expect(await attractions.countDocuments()).toBe(8);
    expect(await currencies.countDocuments()).toBe(7);

    const jfk = await airports.findOne({ iataCode: 'JFK' }).lean();
    expect(jfk).toMatchObject({
      name: 'John F. Kennedy International Airport',
      cityId: 'new_york',
      countryCode: 'US',
      timeZone: 'America/New_York',
    });
    const att = await attractions.findOne({ attractionId: 'att-8' }).lean();
    expect(att).toMatchObject({ name: 'Römerberg', cityId: 'frankfurt' });
  });

  it('is idempotent: running again adds no duplicates and restores edited records', async () => {
    await countries.updateOne({ code: 'EG' }, { $set: { name: 'Changed' } });

    const counts = await seeder.seedFromFiles();
    await seeder.seedFromFiles();

    expect(counts).toEqual({
      countries: 8,
      cities: 8,
      airports: 8,
      attractions: 8,
      currencies: 7,
    });
    expect(await countries.countDocuments()).toBe(8);
    expect(await airports.countDocuments()).toBe(8);
    expect((await countries.findOne({ code: 'EG' }).lean())?.name).toBe(
      'Egypt',
    );
  });

  it('GET /api/countries is public, paginated and searchable', async () => {
    const all = await request(ctx.server).get('/api/countries').expect(200);
    const allBody = all.body as Paginated<CountryView>;
    expect(allBody).toMatchObject({ total: 8, page: 1, limit: 10 });
    expect(allBody.items[0]).toEqual({
      code: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });

    const page = await request(ctx.server)
      .get('/api/countries?limit=3&page=3')
      .expect(200);
    expect((page.body as Paginated<CountryView>).items).toHaveLength(2);

    const search = await request(ctx.server)
      .get('/api/countries?search=united')
      .expect(200);
    const found = (search.body as Paginated<CountryView>).items;
    expect(found.map((c) => c.code).sort()).toEqual(['AE', 'GB', 'US']);
  });

  it('GET /api/cities filters by country', async () => {
    const res = await request(ctx.server)
      .get('/api/cities?countryCode=de')
      .expect(200);
    expect(res.body).toMatchObject({
      total: 1,
      items: [{ cityId: 'frankfurt', name: 'Frankfurt', countryCode: 'DE' }],
    });

    await request(ctx.server).get('/api/cities?countryCode=GER').expect(400);
  });

  it('GET /api/currencies lists each supported currency once', async () => {
    const res = await request(ctx.server).get('/api/currencies').expect(200);
    const body = res.body as Paginated<CurrencyView>;
    expect(body.total).toBe(7);
    expect(body.items).toContainEqual({
      code: 'EUR',
      countryCodes: ['DE', 'FR'],
    });
  });

  it('registers the real lists with the itinerary PlaceCatalog', async () => {
    const lists = ctx.moduleRef.get(PlaceCatalog).get();
    expect(lists).toBeDefined();
    expect(await lists?.isCountry('EG')).toBe(true);
    expect(await lists?.isCountry('ZZ')).toBe(false);
    expect(await lists?.isCity('new_york')).toBe(true);
    expect(await lists?.isCity('atlantis')).toBe(false);

    const service = ctx.moduleRef.get(ReferenceDataService);
    expect(await service.isCurrency('JPY')).toBe(true);
    expect(await service.isCurrency('XYZ')).toBe(false);
  });

  it('ACC-09: the profile accepts only supported currencies (CURRENCY_CATALOG)', async () => {
    const users = ctx.moduleRef.get(UsersService);
    const passwords = ctx.moduleRef.get(PasswordService);
    await users.create({
      name: 'Currency User',
      email: 'currency@example.com',
      passwordHash: await passwords.hash('Passw0rd!'),
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email: 'currency@example.com', password: 'Passw0rd!' })
      .expect(200);

    // Looks like a currency code but is not in the countries dataset.
    const bad = await client
      .patch('/api/users/me')
      .send({ preferredCurrency: 'XYZ' })
      .expect(400);
    const fields = (
      (bad.body as { errors?: { field: string }[] }).errors ?? []
    ).map((e) => e.field);
    expect(fields).toEqual(['preferredCurrency']);

    const ok = await client
      .patch('/api/users/me')
      .send({ preferredCurrency: 'eur' })
      .expect(200);
    expect((ok.body as { preferredCurrency: string }).preferredCurrency).toBe(
      'EUR',
    );
  });
});
