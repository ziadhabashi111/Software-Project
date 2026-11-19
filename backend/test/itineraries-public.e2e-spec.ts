import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { AuthorItineraries } from '../src/blog/author-itineraries';
import { HotelSearchHook } from '../src/itineraries/hotel-search';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { PlaceCatalog } from '../src/itineraries/places';
import {
  Itinerary,
  ItineraryDocument,
} from '../src/itineraries/schemas/itinerary.schema';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  errors?: { field: string; messages: string[] }[];
}

interface ActivityView {
  id: string;
  name: string;
  images: unknown[];
}

interface DayView {
  id: string;
  city: string;
  activities: ActivityView[];
}

interface ItineraryView {
  id: string;
  title: string;
  visibility?: string;
  isHidden?: boolean;
  days: DayView[];
  clonedFrom?: { itineraryId: string; authorId: string; authorName: string };
  author?: { id: string; name: string };
  budget?: { currency: string } | null;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface ListItem {
  id: string;
  title: string;
  dayCount: number;
  author: { id: string; name: string };
}

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

describe('Public itineraries, cloning and hotels (ITN-21, ITN-25, BLG-12; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let itineraryModel: Model<ItineraryDocument>;
  let userModel: Model<UserDocument>;
  let hotelSearch: HotelSearchHook;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, ItinerariesModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    hotelSearch = ctx.moduleRef.get(HotelSearchHook);
    itineraryModel = ctx.moduleRef.get<Model<ItineraryDocument>>(
      getModelToken(Itinerary.name),
    );
    userModel = ctx.moduleRef.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    // The reference-data module is not part of this app: stand in for it.
    ctx.moduleRef.get(PlaceCatalog).register({
      isCountry: () => Promise.resolve(true),
      isCity: () => Promise.resolve(true),
      matchKeyword: (keyword) =>
        Promise.resolve(
          keyword.toLowerCase() === 'egypt'
            ? { countryCodes: ['EG'], cityIds: ['cairo', 'luxor'] }
            : { countryCodes: [], cityIds: [] },
        ),
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(role: Role = Role.USER, name?: string) {
    counter += 1;
    const email = `public${counter}@example.com`;
    const doc = await users.create({
      name: name ?? `Traveller ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: doc.id, client };
  }

  type Client = Awaited<ReturnType<typeof loggedInAs>>['client'];

  /** An itinerary with one day per city; `public` makes it visible to everyone. */
  async function itineraryOf(
    client: Client,
    options: {
      title: string;
      cities: string[];
      countries?: string[];
      isPublic?: boolean;
    },
  ): Promise<ItineraryView> {
    const created = (
      await client
        .post('/api/itineraries')
        .send({
          title: options.title,
          countries: options.countries ?? ['EG'],
          startDate: '2027-03-01',
        })
        .expect(201)
    ).body as ItineraryView;
    for (const city of options.cities) {
      await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city })
        .expect(201);
    }
    if (options.isPublic) {
      await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ visibility: 'public' })
        .expect(200);
    }
    return (await client.get(`/api/itineraries/${created.id}`).expect(200))
      .body as ItineraryView;
  }

  const guest = () => request(ctx.server);

  describe('GET /api/itineraries/public/search (ITN-21)', () => {
    it('is open to visitors and lists only public, visible itineraries of active authors', async () => {
      const token = `Srch${counter}x`;
      const author = await loggedInAs(Role.USER, 'Nora');
      const hiddenAuthor = await loggedInAs();
      const gone = await loggedInAs();

      const shown = await itineraryOf(author.client, {
        title: `${token} shown`,
        cities: ['cairo'],
        isPublic: true,
      });
      await itineraryOf(author.client, {
        title: `${token} private`,
        cities: ['cairo'],
      });
      const hidden = await itineraryOf(hiddenAuthor.client, {
        title: `${token} hidden`,
        cities: ['cairo'],
        isPublic: true,
      });
      await itineraryModel.updateOne({ _id: hidden.id }, { isHidden: true });
      await itineraryOf(gone.client, {
        title: `${token} deactivated`,
        cities: ['cairo'],
        isPublic: true,
      });
      await userModel.updateOne(
        { _id: gone.id },
        { status: UserStatus.DEACTIVATED },
      );

      const res = await guest()
        .get(`/api/itineraries/public/search?q=${token}`)
        .expect(200);
      const page = res.body as Page<ListItem>;
      expect(page.items.map((i) => i.id)).toEqual([shown.id]);
      expect(page.items[0]).toMatchObject({
        title: `${token} shown`,
        dayCount: 1,
        author: { id: author.id, name: 'Nora' },
      });
      expect(page.limit).toBe(10);
    });

    it('finds an itinerary by the name of a country or city it covers', async () => {
      const author = await loggedInAs();
      const nile = await itineraryOf(author.client, {
        title: 'Nile cruise by name',
        cities: ['luxor'],
        countries: ['EG'],
        isPublic: true,
      });
      const ids = (
        (
          await guest()
            .get('/api/itineraries/public/search?q=egypt')
            .expect(200)
        ).body as Page<ListItem>
      ).items.map((i) => i.id);
      expect(ids).toContain(nile.id);
    });

    it('filters by country, city and the number of days, inclusive', async () => {
      const author = await loggedInAs();
      const short = await itineraryOf(author.client, {
        title: 'Filter short',
        cities: ['cairo', 'cairo'],
        countries: ['EG'],
        isPublic: true,
      });
      const long = await itineraryOf(author.client, {
        title: 'Filter long',
        cities: ['paris', 'paris', 'paris', 'paris'],
        countries: ['FR'],
        isPublic: true,
      });
      const idsOf = async (query: string) =>
        (
          (
            await guest()
              .get(`/api/itineraries/public/search?${query}`)
              .expect(200)
          ).body as Page<ListItem>
        ).items.map((i) => i.id);

      expect(await idsOf('country=FR')).toContain(long.id);
      expect(await idsOf('country=FR')).not.toContain(short.id);
      expect(await idsOf('city=cairo')).toContain(short.id);
      expect(await idsOf('city=cairo')).not.toContain(long.id);
      expect(await idsOf('minDays=3&maxDays=4')).toContain(long.id);
      expect(await idsOf('minDays=3&maxDays=4')).not.toContain(short.id);
      expect(await idsOf('minDays=2&maxDays=2')).toEqual(
        expect.arrayContaining([short.id]),
      );
    });

    it.each([
      ['fewest days above most days', 'minDays=9&maxDays=3', 'minDays'],
      ['a malformed country', 'country=EGY', 'country'],
      ['a page size above the maximum', 'limit=101', 'limit'],
    ])('rejects %s', async (_name, query, field) => {
      const res = await guest()
        .get(`/api/itineraries/public/search?${query}`)
        .expect(400);
      expect(fieldsOf(res)).toContain(field);
    });
  });

  describe('GET /api/itineraries/public/:id (ITN-21)', () => {
    it('shows a public itinerary read-only, with its author, days, activities and budget', async () => {
      const author = await loggedInAs(Role.USER, 'Omar');
      const it = await itineraryOf(author.client, {
        title: 'Open to all',
        cities: ['cairo', 'luxor'],
        isPublic: true,
      });
      await author.client
        .post(`/api/itineraries/${it.id}/days/${it.days[0].id}/activities`)
        .send({ name: 'Pyramids', cost: 20, currency: 'USD' })
        .expect(201);

      const view = (
        await guest().get(`/api/itineraries/public/${it.id}`).expect(200)
      ).body as ItineraryView;
      expect(view.author).toEqual({ id: author.id, name: 'Omar' });
      expect(view.days.map((d) => d.city)).toEqual(['cairo', 'luxor']);
      expect(view.days[0].activities[0].name).toBe('Pyramids');
      expect(view.budget?.currency).toBe('USD');
      expect('isHidden' in view).toBe(false);
      expect('visibility' in view).toBe(false);
    });

    it('answers 404 for a private itinerary, a hidden one, a deactivated author and an unknown id', async () => {
      const author = await loggedInAs();
      const priv = await itineraryOf(author.client, {
        title: 'Mine only',
        cities: ['cairo'],
      });
      const hidden = await itineraryOf(author.client, {
        title: 'Moderated',
        cities: ['cairo'],
        isPublic: true,
      });
      await itineraryModel.updateOne({ _id: hidden.id }, { isHidden: true });
      const gone = await loggedInAs();
      const orphan = await itineraryOf(gone.client, {
        title: 'Author left',
        cities: ['cairo'],
        isPublic: true,
      });
      await userModel.updateOne(
        { _id: gone.id },
        { status: UserStatus.DEACTIVATED },
      );

      for (const id of [
        priv.id,
        hidden.id,
        orphan.id,
        '665f1c2a9b1e8a0012345670',
      ]) {
        await guest().get(`/api/itineraries/public/${id}`).expect(404);
      }
    });

    it('answers 400 for an unsupported currency, not a hidden failure', async () => {
      const author = await loggedInAs();
      const it = await itineraryOf(author.client, {
        title: 'Currency check',
        cities: ['cairo'],
        isPublic: true,
      });
      await guest()
        .get(`/api/itineraries/public/${it.id}?currency=usd1`)
        .expect(400);
    });
  });

  describe('POST /api/itineraries/:id/clone (ITN-21)', () => {
    async function publicWithBudget() {
      const author = await loggedInAs(Role.USER, 'Layla');
      const it = await itineraryOf(author.client, {
        title: 'To be cloned',
        cities: ['cairo', 'luxor'],
        isPublic: true,
      });
      await author.client
        .post(`/api/itineraries/${it.id}/days/${it.days[0].id}/activities`)
        .send({ name: 'Pyramids', cost: 20, currency: 'USD' })
        .expect(201);
      await author.client
        .post(`/api/itineraries/${it.id}/days/${it.days[1].id}/budgets`)
        .send({ category: 'food', amount: 40, currency: 'USD' })
        .expect(201);
      const original = (
        await author.client.get(`/api/itineraries/${it.id}`).expect(200)
      ).body as ItineraryView;
      return { author, original };
    }

    it('needs a login', async () => {
      const { original } = await publicWithBudget();
      await guest().post(`/api/itineraries/${original.id}/clone`).expect(401);
    });

    it('makes a private copy of mine that credits the author and carries the days, activities and budget', async () => {
      const { author, original } = await publicWithBudget();
      const me = await loggedInAs();

      const copy = (
        await me.client
          .post(`/api/itineraries/${original.id}/clone`)
          .expect(201)
      ).body as ItineraryView;
      expect(copy.id).not.toBe(original.id);
      expect(copy.visibility).toBe('private');
      expect(copy.clonedFrom).toEqual({
        itineraryId: original.id,
        authorId: author.id,
        authorName: 'Layla',
      });
      expect(copy.days.map((d) => d.city)).toEqual(['cairo', 'luxor']);
      expect(copy.days[0].activities.map((a) => a.name)).toEqual(['Pyramids']);
      expect(copy.days[0].activities[0].images).toEqual([]);
      expect(copy.days.map((d) => d.id)).not.toEqual(
        original.days.map((d) => d.id),
      );

      const budgets = (
        await me.client.get(`/api/itineraries/${copy.id}/budgets`).expect(200)
      ).body as { entries: { dayId: string; amount: number }[] };
      expect(budgets.entries).toHaveLength(1);
      expect(budgets.entries[0]).toMatchObject({
        dayId: copy.days[1].id,
        amount: 40,
      });

      const mine = (await me.client.get('/api/itineraries').expect(200))
        .body as Page<{ id: string }>;
      expect(mine.items.map((i) => i.id)).toContain(copy.id);
    });

    it('is independent of the original in both directions', async () => {
      const { author, original } = await publicWithBudget();
      const me = await loggedInAs();
      const copy = (
        await me.client
          .post(`/api/itineraries/${original.id}/clone`)
          .expect(201)
      ).body as ItineraryView;

      await me.client
        .post(`/api/itineraries/${copy.id}/days`)
        .send({ city: 'giza' })
        .expect(201);
      await author.client
        .delete(
          `/api/itineraries/${original.id}/days/${original.days[0].id}?confirm=true`,
        )
        .expect(200);

      const originalNow = (
        await author.client.get(`/api/itineraries/${original.id}`).expect(200)
      ).body as ItineraryView;
      const copyNow = (
        await me.client.get(`/api/itineraries/${copy.id}`).expect(200)
      ).body as ItineraryView;
      expect(originalNow.days.map((d) => d.city)).toEqual(['luxor']);
      expect(copyNow.days.map((d) => d.city)).toEqual([
        'cairo',
        'luxor',
        'giza',
      ]);
    });

    it("answers 404 for someone else's private or hidden itinerary, and 403 for non-travellers", async () => {
      const owner = await loggedInAs();
      const me = await loggedInAs();
      const priv = await itineraryOf(owner.client, {
        title: 'Private',
        cities: ['cairo'],
      });
      const hidden = await itineraryOf(owner.client, {
        title: 'Hidden',
        cities: ['cairo'],
        isPublic: true,
      });
      await itineraryModel.updateOne({ _id: hidden.id }, { isHidden: true });
      await me.client.post(`/api/itineraries/${priv.id}/clone`).expect(404);
      await me.client.post(`/api/itineraries/${hidden.id}/clone`).expect(404);

      const admin = await loggedInAs(Role.ADMIN);
      await admin.client.post(`/api/itineraries/${priv.id}/clone`).expect(403);
    });
  });

  describe('GET /api/itineraries/:id/hotels (ITN-25)', () => {
    it('answers 503 until the hotel search is connected, then uses it for the group’s dates', async () => {
      const me = await loggedInAs();
      const it = await itineraryOf(me.client, {
        title: 'Hotels',
        cities: ['cairo', 'cairo', 'luxor'],
      });
      await me.client.get(`/api/itineraries/${it.id}/hotels`).expect(503);

      const search = jest.fn().mockResolvedValue({
        items: [{ name: 'Nile View' }],
        total: 1,
        page: 1,
        limit: 10,
      });
      hotelSearch.register({ search });

      const res = await me.client
        .get(`/api/itineraries/${it.id}/hotels?group=1&guests=3&rooms=2`)
        .expect(200);
      expect(search).toHaveBeenCalledWith({
        city: 'cairo',
        checkIn: '2027-03-01',
        checkOut: '2027-03-03',
        guests: 3,
        rooms: 2,
        page: 1,
        limit: 10,
      });
      expect(res.body).toMatchObject({
        itineraryId: it.id,
        group: { number: 1, city: 'cairo', startDay: 1, endDay: 2 },
        search: { checkIn: '2027-03-01', checkOut: '2027-03-03' },
        hotels: { total: 1 },
      });

      const second = (
        await me.client
          .get(`/api/itineraries/${it.id}/hotels?group=2`)
          .expect(200)
      ).body as { search: { city: string; checkIn: string; checkOut: string } };
      expect(second.search).toMatchObject({
        city: 'luxor',
        checkIn: '2027-03-03',
        checkOut: '2027-03-04',
      });
    });

    it('is for the owner only and validates the group and the party', async () => {
      const me = await loggedInAs();
      const other = await loggedInAs();
      const it = await itineraryOf(me.client, {
        title: 'Mine',
        cities: ['cairo'],
      });
      hotelSearch.register({
        search: () =>
          Promise.resolve({ items: [], total: 0, page: 1, limit: 10 }),
      });
      await other.client.get(`/api/itineraries/${it.id}/hotels`).expect(404);
      await guest().get(`/api/itineraries/${it.id}/hotels`).expect(401);

      const group = await me.client
        .get(`/api/itineraries/${it.id}/hotels?group=4`)
        .expect(400);
      expect(fieldsOf(group)).toContain('group');
      const rooms = await me.client
        .get(`/api/itineraries/${it.id}/hotels?guests=1&rooms=3`)
        .expect(400);
      expect(fieldsOf(rooms)).toContain('rooms');
    });
  });

  describe('an author’s public itineraries for the blog (BLG-12)', () => {
    it('lists only that author’s public, visible itineraries, newest first', async () => {
      const author = await loggedInAs();
      const other = await loggedInAs();
      const older = await itineraryOf(author.client, {
        title: 'Author older',
        cities: ['cairo'],
        isPublic: true,
      });
      const newer = await itineraryOf(author.client, {
        title: 'Author newer',
        cities: ['cairo', 'luxor'],
        isPublic: true,
      });
      await itineraryOf(author.client, {
        title: 'Author private',
        cities: ['cairo'],
      });
      await itineraryOf(other.client, {
        title: 'Someone else',
        cities: ['cairo'],
        isPublic: true,
      });
      await itineraryModel.updateOne(
        { _id: older.id },
        { updatedAt: new Date('2026-01-01') },
        { timestamps: false },
      );

      const result = await ctx.moduleRef
        .get(AuthorItineraries, { strict: false })
        .publicForAuthor(author.id, { skip: 0, limit: 10 });
      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.id)).toEqual([newer.id, older.id]);
      expect(result.items[0]).toMatchObject({
        title: 'Author newer',
        dayCount: 2,
        startDate: '2027-03-01',
      });
    });
  });
});
