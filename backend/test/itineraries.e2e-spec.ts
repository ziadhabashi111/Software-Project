import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { ItineraryBudgets } from '../src/itineraries/itinerary-budgets';
import type { ItineraryBudgetProvider } from '../src/itineraries/itinerary-budgets';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { PlaceCatalog } from '../src/itineraries/places';
import {
  Itinerary,
  ItineraryDocument,
} from '../src/itineraries/schemas/itinerary.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface ActivityView {
  id: string;
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
  images: unknown[];
}

interface DayView {
  id: string;
  number: number;
  date: string;
  city: string;
  notes?: string;
  activities: ActivityView[];
}

interface GroupView {
  city: string;
  startDay: number;
  endDay: number;
  dayCount: number;
  startDate: string;
  endDate: string;
  dayIds: string[];
  subtotal: { amount: number; currency: string } | null;
}

interface ItineraryView {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  visibility: string;
  isHidden: boolean;
  days: DayView[];
  groups: GroupView[];
  updatedAt: string;
}

interface SummaryView {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  dayCount: number;
  visibility: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

function fieldsOf(res: request.Response): string[] {
  return ((res.body as ErrorBody).errors ?? []).map((e) => e.field);
}

describe('Itineraries: structure, days and activities (ITN-01..10, 20; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let model: Model<ItineraryDocument>;
  let places: PlaceCatalog;
  let budgets: ItineraryBudgets;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, ItinerariesModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    places = ctx.moduleRef.get(PlaceCatalog);
    budgets = ctx.moduleRef.get(ItineraryBudgets);
    model = ctx.moduleRef.get<Model<ItineraryDocument>>(
      getModelToken(Itinerary.name),
    );
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(role: Role = Role.USER) {
    counter += 1;
    const email = `traveller${counter}@example.com`;
    const doc = await users.create({
      name: `Traveller ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: doc.id, email, client };
  }

  type Client = Awaited<ReturnType<typeof loggedInAs>>['client'];

  async function createItinerary(
    client: Client,
    overrides: Record<string, unknown> = {},
  ): Promise<ItineraryView> {
    const res = await client
      .post('/api/itineraries')
      .send({
        title: 'Egypt and Dubai',
        countries: ['EG', 'AE'],
        startDate: '2027-03-01',
        ...overrides,
      })
      .expect(201);
    return res.body as ItineraryView;
  }

  async function addDay(
    client: Client,
    itineraryId: string,
    city: string,
    notes?: string,
  ): Promise<ItineraryView> {
    const res = await client
      .post(`/api/itineraries/${itineraryId}/days`)
      .send({ city, ...(notes ? { notes } : {}) })
      .expect(201);
    return res.body as ItineraryView;
  }

  const someId = () => new Types.ObjectId().toHexString();

  /** Pretends the budget module (Youssef) is connected. Call mockRestore() when done. */
  function useBudgets(provider: ItineraryBudgetProvider) {
    return jest.spyOn(budgets, 'get').mockReturnValue(provider);
  }

  describe('access control', () => {
    const id = new Types.ObjectId().toHexString();
    const endpoints: [string, string][] = [
      ['post', '/api/itineraries'],
      ['get', '/api/itineraries'],
      ['get', `/api/itineraries/${id}`],
      ['patch', `/api/itineraries/${id}`],
      ['delete', `/api/itineraries/${id}?confirm=true`],
      ['post', `/api/itineraries/${id}/days`],
      ['patch', `/api/itineraries/${id}/days/reorder`],
      ['patch', `/api/itineraries/${id}/days/${id}`],
      ['delete', `/api/itineraries/${id}/days/${id}?confirm=true`],
      ['post', `/api/itineraries/${id}/days/${id}/activities`],
      ['patch', `/api/activities/${id}`],
      ['delete', `/api/activities/${id}`],
    ];

    it.each(endpoints)('%s %s needs a login', async (method, url) => {
      await (
        request(ctx.server) as unknown as Record<
          string,
          (u: string) => request.Test
        >
      )
        [method](url)
        .expect(401);
    });

    it.each(endpoints)(
      '%s %s is for regular users only (403 for admins and moderators)',
      async (method, url) => {
        for (const role of [
          Role.ADMIN,
          Role.HOTEL_MODERATOR,
          Role.AIRLINE_MODERATOR,
        ]) {
          const { client } = await loggedInAs(role);
          await (
            client as unknown as Record<string, (u: string) => request.Test>
          )
            [method](url)
            .expect(403);
        }
      },
    );
  });

  describe('POST /api/itineraries (ITN-01)', () => {
    it('creates a private itinerary with no days', async () => {
      const { client } = await loggedInAs();
      const res = await client
        .post('/api/itineraries')
        .send({
          title: '  Egypt and Dubai  ',
          countries: ['eg', 'AE'],
          startDate: '2027-03-01',
        })
        .expect(201);
      const body = res.body as ItineraryView;
      expect(body).toMatchObject({
        title: 'Egypt and Dubai',
        countries: ['EG', 'AE'],
        startDate: '2027-03-01',
        visibility: 'private',
        isHidden: false,
        days: [],
        groups: [],
      });
      expect(body.id).toEqual(expect.any(String));
    });

    it.each([
      ['a missing title', { title: undefined }, 'title'],
      ['an empty title', { title: '   ' }, 'title'],
      ['a title over 100 characters', { title: 'x'.repeat(101) }, 'title'],
      ['no countries', { countries: [] }, 'countries'],
      ['a country that is not a code', { countries: ['Egypt'] }, 'countries'],
      ['a duplicated country', { countries: ['EG', 'eg'] }, 'countries'],
      ['a missing start date', { startDate: undefined }, 'startDate'],
      ['an impossible start date', { startDate: '2027-13-01' }, 'startDate'],
      ['a start date that is not a date', { startDate: 'soon' }, 'startDate'],
      [
        'a date with a time',
        { startDate: '2027-03-01T10:00:00Z' },
        'startDate',
      ],
    ])('rejects %s', async (_name, change, field) => {
      const { client } = await loggedInAs();
      const res = await client
        .post('/api/itineraries')
        .send({
          title: 'Trip',
          countries: ['EG'],
          startDate: '2027-03-01',
          ...change,
        })
        .expect(400);
      expect(fieldsOf(res)).toContain(field);
    });

    it('accepts a title of exactly 100 characters', async () => {
      const { client } = await loggedInAs();
      await createItinerary(client, { title: 'x'.repeat(100) });
    });

    it('cannot be created public or hidden, or for someone else', async () => {
      const { client } = await loggedInAs();
      for (const extra of [
        { visibility: 'public' },
        { isHidden: true },
        { owner: someId() },
      ]) {
        await client
          .post('/api/itineraries')
          .send({
            title: 'Trip',
            countries: ['EG'],
            startDate: '2027-03-01',
            ...extra,
          })
          .expect(400);
      }
    });
  });

  describe('GET /api/itineraries (ITN-03)', () => {
    it('lists only my itineraries, most recently updated first, paginated', async () => {
      const mine = await loggedInAs();
      const other = await loggedInAs();
      const first = await createItinerary(mine.client, { title: 'First' });
      const second = await createItinerary(mine.client, { title: 'Second' });
      await createItinerary(other.client, { title: 'Not mine' });
      await addDay(mine.client, first.id, 'cairo');

      const res = await mine.client.get('/api/itineraries').expect(200);
      const body = res.body as Page<SummaryView>;
      expect(body.total).toBe(2);
      expect(body.limit).toBe(10);
      // The first itinerary was updated last (a day was added), so it leads.
      expect(body.items.map((i) => i.id)).toEqual([first.id, second.id]);
      expect(body.items[0]).toMatchObject({
        title: 'First',
        countries: ['EG', 'AE'],
        startDate: '2027-03-01',
        dayCount: 1,
        visibility: 'private',
      });
      expect(body.items[0]).not.toHaveProperty('days');
    });

    it('pages with 10 per page', async () => {
      const { client } = await loggedInAs();
      for (let i = 0; i < 12; i++) await createItinerary(client);
      const one = await client.get('/api/itineraries').expect(200);
      expect((one.body as Page<SummaryView>).items).toHaveLength(10);
      const two = await client.get('/api/itineraries?page=2').expect(200);
      expect((two.body as Page<SummaryView>).items).toHaveLength(2);
      await client.get('/api/itineraries?page=0').expect(400);
    });

    it('is an empty page for a new user', async () => {
      const { client } = await loggedInAs();
      const res = await client.get('/api/itineraries').expect(200);
      expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 10 });
    });
  });

  describe('GET /api/itineraries/:id (ITN-03, ITN-11 ownership)', () => {
    it('shows the full itinerary to its owner', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const res = await client
        .get(`/api/itineraries/${created.id}`)
        .expect(200);
      expect((res.body as ItineraryView).id).toBe(created.id);
    });

    it('answers 404 to everyone else, even for a public itinerary', async () => {
      const owner = await loggedInAs();
      const other = await loggedInAs();
      const created = await createItinerary(owner.client);
      await owner.client
        .patch(`/api/itineraries/${created.id}`)
        .send({ visibility: 'public' })
        .expect(200);
      await other.client.get(`/api/itineraries/${created.id}`).expect(404);
    });

    it('answers 404 for an unknown id and for an id that is not an ObjectId', async () => {
      const { client } = await loggedInAs();
      await client.get(`/api/itineraries/${someId()}`).expect(404);
      await client.get('/api/itineraries/not-an-id').expect(404);
    });
  });

  describe('PATCH /api/itineraries/:id (ITN-01, ITN-20)', () => {
    it('edits title, countries and start date; day dates follow the start date', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      await addDay(client, created.id, 'cairo');
      await addDay(client, created.id, 'cairo');
      const res = await client
        .patch(`/api/itineraries/${created.id}`)
        .send({
          title: 'New title',
          countries: ['GB'],
          startDate: '2027-04-10',
        })
        .expect(200);
      const body = res.body as ItineraryView;
      expect(body).toMatchObject({
        title: 'New title',
        countries: ['GB'],
        startDate: '2027-04-10',
      });
      expect(body.days.map((d) => d.date)).toEqual([
        '2027-04-10',
        '2027-04-11',
      ]);
    });

    it('changes visibility and Private takes effect immediately', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const pub = await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ visibility: 'public' })
        .expect(200);
      expect((pub.body as ItineraryView).visibility).toBe('public');
      const priv = await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ visibility: 'private' })
        .expect(200);
      expect((priv.body as ItineraryView).visibility).toBe('private');
    });

    it('saves nothing unless every field is valid', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const res = await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ title: 'Changed', startDate: 'nope' })
        .expect(400);
      expect(fieldsOf(res)).toContain('startDate');
      const after = await client.get(`/api/itineraries/${created.id}`);
      expect((after.body as ItineraryView).title).toBe('Egypt and Dubai');
    });

    it.each([
      ['an empty title', { title: '' }],
      ['a title over 100 characters', { title: 'x'.repeat(101) }],
      ['no countries', { countries: [] }],
      ['an unknown visibility', { visibility: 'friends' }],
      ['a hidden flag', { isHidden: true }],
    ])('rejects %s', async (_name, change) => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      await client
        .patch(`/api/itineraries/${created.id}`)
        .send(change)
        .expect(400);
    });

    it("answers 404 for someone else's itinerary and changes nothing", async () => {
      const owner = await loggedInAs();
      const other = await loggedInAs();
      const created = await createItinerary(owner.client);
      await other.client
        .patch(`/api/itineraries/${created.id}`)
        .send({ title: 'Mine now' })
        .expect(404);
      const after = await owner.client.get(`/api/itineraries/${created.id}`);
      expect((after.body as ItineraryView).title).toBe('Egypt and Dubai');
    });
  });

  describe('DELETE /api/itineraries/:id (ITN-01)', () => {
    it('needs ?confirm=true', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const res = await client
        .delete(`/api/itineraries/${created.id}`)
        .expect(400);
      expect(fieldsOf(res)).toContain('confirm');
      await client
        .delete(`/api/itineraries/${created.id}?confirm=false`)
        .expect(400);
      await client.get(`/api/itineraries/${created.id}`).expect(200);
    });

    it('deletes after confirmation', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      await client
        .delete(`/api/itineraries/${created.id}?confirm=true`)
        .expect(204);
      await client.get(`/api/itineraries/${created.id}`).expect(404);
      expect(await model.countDocuments({ _id: created.id })).toBe(0);
    });

    it("answers 404 for someone else's itinerary and keeps it", async () => {
      const owner = await loggedInAs();
      const other = await loggedInAs();
      const created = await createItinerary(owner.client);
      await other.client
        .delete(`/api/itineraries/${created.id}?confirm=true`)
        .expect(404);
      await owner.client.get(`/api/itineraries/${created.id}`).expect(200);
    });
  });

  describe('days (ITN-05, 07, 08, 09)', () => {
    it('adds days with sequential numbers and dates from the start date', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client, {
        startDate: '2027-01-30',
      });
      await addDay(client, created.id, 'cairo', 'Pyramids');
      const body = await addDay(client, created.id, 'cairo');
      await addDay(client, created.id, 'dubai');
      const res = await client
        .get(`/api/itineraries/${created.id}`)
        .expect(200);
      const days = (res.body as ItineraryView).days;
      expect(body.days).toHaveLength(2);
      expect(days.map((d) => [d.number, d.date, d.city])).toEqual([
        [1, '2027-01-30', 'cairo'],
        [2, '2027-01-31', 'cairo'],
        [3, '2027-02-01', 'dubai'],
      ]);
      expect(days[0].notes).toBe('Pyramids');
      expect(days[0].activities).toEqual([]);
    });

    it('requires a city and limits the notes', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const missing = await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ notes: 'no city' })
        .expect(400);
      expect(fieldsOf(missing)).toContain('city');
      const badCity = await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city: 'Not A Slug!' })
        .expect(400);
      expect(fieldsOf(badCity)).toContain('city');
      const longNotes = await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city: 'cairo', notes: 'x'.repeat(2001) })
        .expect(400);
      expect(fieldsOf(longNotes)).toContain('notes');
    });

    it('allows at most 60 days', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      await model.updateOne(
        { _id: created.id },
        {
          $set: {
            days: Array.from({ length: 60 }, () => ({
              city: 'cairo',
              activities: [],
            })),
          },
        },
      );
      const res = await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city: 'cairo' })
        .expect(409);
      expect((res.body as ErrorBody).code).toBe('MAX_DAYS_REACHED');
      const after = await client.get(`/api/itineraries/${created.id}`);
      expect((after.body as ItineraryView).days).toHaveLength(60);
    });

    it("edits a day's city and notes", async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const withDay = await addDay(client, created.id, 'cairo', 'Old notes');
      const dayId = withDay.days[0].id;
      const res = await client
        .patch(`/api/itineraries/${created.id}/days/${dayId}`)
        .send({ city: 'dubai', notes: 'New notes' })
        .expect(200);
      expect((res.body as ItineraryView).days[0]).toMatchObject({
        id: dayId,
        city: 'dubai',
        notes: 'New notes',
      });
      const cleared = await client
        .patch(`/api/itineraries/${created.id}/days/${dayId}`)
        .send({ notes: null })
        .expect(200);
      expect((cleared.body as ItineraryView).days[0].notes).toBeUndefined();
    });

    it('answers 404 for an unknown day and for a day of someone else', async () => {
      const owner = await loggedInAs();
      const other = await loggedInAs();
      const created = await createItinerary(owner.client);
      const withDay = await addDay(owner.client, created.id, 'cairo');
      await owner.client
        .patch(`/api/itineraries/${created.id}/days/${someId()}`)
        .send({ city: 'dubai' })
        .expect(404);
      await other.client
        .patch(`/api/itineraries/${created.id}/days/${withDay.days[0].id}`)
        .send({ city: 'dubai' })
        .expect(404);
      await other.client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city: 'dubai' })
        .expect(404);
    });

    it('deletes a day after confirmation; the rest are renumbered and re-dated', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      await addDay(client, created.id, 'cairo');
      await addDay(client, created.id, 'dubai');
      const full = await addDay(client, created.id, 'london');
      const [, second] = full.days;

      const unconfirmed = await client
        .delete(`/api/itineraries/${created.id}/days/${second.id}`)
        .expect(400);
      expect(fieldsOf(unconfirmed)).toContain('confirm');

      const res = await client
        .delete(`/api/itineraries/${created.id}/days/${second.id}?confirm=true`)
        .expect(200);
      const days = (res.body as ItineraryView).days;
      expect(days.map((d) => [d.number, d.date, d.city])).toEqual([
        [1, '2027-03-01', 'cairo'],
        [2, '2027-03-02', 'london'],
      ]);
    });

    it('merges the neighbours into one group when the day between them is deleted', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      await addDay(client, created.id, 'cairo');
      await addDay(client, created.id, 'dubai');
      const full = await addDay(client, created.id, 'cairo');
      expect(full.groups).toHaveLength(3);
      const res = await client
        .delete(
          `/api/itineraries/${created.id}/days/${full.days[1].id}?confirm=true`,
        )
        .expect(200);
      const groups = (res.body as ItineraryView).groups;
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ city: 'cairo', dayCount: 2 });
    });

    it('tells the budget module when a day or an itinerary is deleted (ITN-07)', async () => {
      const removed: string[] = [];
      const spy = useBudgets({
        dayTotals: () => Promise.resolve({ currency: 'EGP', byDay: {} }),
        removeDay: (itineraryId, dayId) => {
          removed.push(`day:${itineraryId}:${dayId}`);
          return Promise.resolve();
        },
        removeItinerary: (itineraryId) => {
          removed.push(`itinerary:${itineraryId}`);
          return Promise.resolve();
        },
      });
      try {
        const { client } = await loggedInAs();
        const created = await createItinerary(client);
        const full = await addDay(client, created.id, 'cairo');
        const dayId = full.days[0].id;
        await client
          .delete(`/api/itineraries/${created.id}/days/${dayId}?confirm=true`)
          .expect(200);
        await client
          .delete(`/api/itineraries/${created.id}?confirm=true`)
          .expect(204);
        expect(removed).toEqual([
          `day:${created.id}:${dayId}`,
          `itinerary:${created.id}`,
        ]);
      } finally {
        spy.mockRestore();
      }
    });

    describe('PATCH .../days/reorder (ITN-08)', () => {
      async function threeDays(client: Client) {
        const created = await createItinerary(client);
        await addDay(client, created.id, 'cairo');
        await addDay(client, created.id, 'cairo');
        const full = await addDay(client, created.id, 'dubai');
        return { id: created.id, days: full.days };
      }

      it('moves a day to a new position and renumbers, re-dates and regroups', async () => {
        const { client } = await loggedInAs();
        const { id, days } = await threeDays(client);
        const res = await client
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ dayId: days[2].id, position: 1 })
          .expect(200);
        const body = res.body as ItineraryView;
        expect(body.days.map((d) => [d.id, d.number, d.date])).toEqual([
          [days[2].id, 1, '2027-03-01'],
          [days[0].id, 2, '2027-03-02'],
          [days[1].id, 3, '2027-03-03'],
        ]);
        expect(body.groups.map((g) => [g.city, g.dayCount])).toEqual([
          ['dubai', 1],
          ['cairo', 2],
        ]);
      });

      it('moves a day later in the list', async () => {
        const { client } = await loggedInAs();
        const { id, days } = await threeDays(client);
        const res = await client
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ dayId: days[0].id, position: 3 })
          .expect(200);
        expect((res.body as ItineraryView).days.map((d) => d.id)).toEqual([
          days[1].id,
          days[2].id,
          days[0].id,
        ]);
      });

      it('leaves the order alone when the day is already there', async () => {
        const { client } = await loggedInAs();
        const { id, days } = await threeDays(client);
        const res = await client
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ dayId: days[1].id, position: 2 })
          .expect(200);
        expect((res.body as ItineraryView).days.map((d) => d.id)).toEqual(
          days.map((d) => d.id),
        );
      });

      it('rejects a position outside the itinerary, and a missing field', async () => {
        const { client } = await loggedInAs();
        const { id, days } = await threeDays(client);
        for (const position of [0, 4, -1, 1.5]) {
          const res = await client
            .patch(`/api/itineraries/${id}/days/reorder`)
            .send({ dayId: days[0].id, position })
            .expect(400);
          expect(fieldsOf(res)).toContain('position');
        }
        await client
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ position: 1 })
          .expect(400);
      });

      it('answers 404 for an unknown day and for someone elses itinerary', async () => {
        const owner = await loggedInAs();
        const other = await loggedInAs();
        const { id, days } = await threeDays(owner.client);
        await owner.client
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ dayId: someId(), position: 1 })
          .expect(404);
        await other.client
          .patch(`/api/itineraries/${id}/days/reorder`)
          .send({ dayId: days[0].id, position: 2 })
          .expect(404);
      });
    });

    describe('city groups and budget subtotals (ITN-09)', () => {
      it('groups consecutive days in the same city with the day count', async () => {
        const { client } = await loggedInAs();
        const created = await createItinerary(client);
        for (const city of ['cairo', 'cairo', 'dubai', 'cairo']) {
          await addDay(client, created.id, city);
        }
        const res = await client.get(`/api/itineraries/${created.id}`);
        const groups = (res.body as ItineraryView).groups;
        expect(
          groups.map((g) => [g.city, g.startDay, g.endDay, g.dayCount]),
        ).toEqual([
          ['cairo', 1, 2, 2],
          ['dubai', 3, 3, 1],
          ['cairo', 4, 4, 1],
        ]);
        expect(groups[0]).toMatchObject({
          startDate: '2027-03-01',
          endDate: '2027-03-02',
        });
        // Until the budget module is connected there is no subtotal.
        expect(groups.every((g) => g.subtotal === null)).toBe(true);
      });

      it("adds up the budget module's day totals per group", async () => {
        const { client } = await loggedInAs();
        const created = await createItinerary(client);
        await addDay(client, created.id, 'cairo');
        await addDay(client, created.id, 'cairo');
        const full = await addDay(client, created.id, 'dubai');
        const [d1, d2] = full.days;
        const asked: { itineraryId: string; ownerId: string }[] = [];
        const provider: ItineraryBudgetProvider = {
          dayTotals: (itineraryId, ownerId) => {
            asked.push({ itineraryId, ownerId });
            return Promise.resolve({
              currency: 'EGP',
              byDay: { [d1.id]: 100.5, [d2.id]: 50 },
            });
          },
          removeDay: () => Promise.resolve(),
          removeItinerary: () => Promise.resolve(),
        };
        const spy = useBudgets(provider);
        try {
          const res = await client
            .get(`/api/itineraries/${created.id}`)
            .expect(200);
          const groups = (res.body as ItineraryView).groups;
          expect(groups[0].subtotal).toEqual({
            amount: 150.5,
            currency: 'EGP',
          });
          // A day without budget entries counts as zero.
          expect(groups[1].subtotal).toEqual({ amount: 0, currency: 'EGP' });
          expect(asked[0].itineraryId).toBe(created.id);
        } finally {
          spy.mockRestore();
        }
      });

      it('still shows the itinerary when the budget module fails', async () => {
        const { client } = await loggedInAs();
        const created = await createItinerary(client);
        await addDay(client, created.id, 'cairo');
        const spy = useBudgets({
          dayTotals: () => Promise.reject(new Error('rates unavailable')),
          removeDay: () => Promise.resolve(),
          removeItinerary: () => Promise.resolve(),
        });
        try {
          const res = await client
            .get(`/api/itineraries/${created.id}`)
            .expect(200);
          expect((res.body as ItineraryView).groups[0].subtotal).toBeNull();
        } finally {
          spy.mockRestore();
        }
      });
    });

    describe('concurrency', () => {
      it('never goes over 60 days when many requests add days at once', async () => {
        const { client } = await loggedInAs();
        const created = await createItinerary(client);
        await model.updateOne(
          { _id: created.id },
          {
            $set: {
              days: Array.from({ length: 55 }, () => ({
                city: 'cairo',
                activities: [],
              })),
            },
          },
        );
        const results = await Promise.all(
          Array.from({ length: 12 }, () =>
            client
              .post(`/api/itineraries/${created.id}/days`)
              .send({ city: 'dubai' }),
          ),
        );
        const statuses = results.map((r) => r.status);
        expect(statuses.filter((s) => s === 201)).toHaveLength(5);
        expect(statuses.filter((s) => s !== 201 && s !== 409)).toEqual([]);
        const after = await client.get(`/api/itineraries/${created.id}`);
        expect((after.body as ItineraryView).days).toHaveLength(60);
      });

      it('keeps every day when several are added at the same time', async () => {
        const { client } = await loggedInAs();
        const created = await createItinerary(client);
        const results = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            client
              .post(`/api/itineraries/${created.id}/days`)
              .send({ city: 'cairo', notes: `day ${i}` }),
          ),
        );
        expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
        const after = await client.get(`/api/itineraries/${created.id}`);
        const days = (after.body as ItineraryView).days;
        expect(days.map((d) => d.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(new Set(days.map((d) => d.notes)).size).toBe(8);
      });
    });
  });

  describe('activities (ITN-10)', () => {
    async function withDay(client: Client) {
      const created = await createItinerary(client);
      const full = await addDay(client, created.id, 'cairo');
      return { itineraryId: created.id, dayId: full.days[0].id };
    }

    it('adds an activity to a day and shows it under that day', async () => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const res = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({
          name: 'Pyramids tour',
          description: 'Guided visit',
          time: '09:30',
          cost: 25.5,
          currency: 'usd',
        })
        .expect(201);
      const activity = res.body as ActivityView;
      expect(activity).toMatchObject({
        name: 'Pyramids tour',
        description: 'Guided visit',
        time: '09:30',
        cost: 25.5,
        currency: 'USD',
        images: [],
      });
      const full = await client.get(`/api/itineraries/${itineraryId}`);
      expect((full.body as ItineraryView).days[0].activities).toHaveLength(1);
      expect((full.body as ItineraryView).days[0].activities[0].id).toBe(
        activity.id,
      );
    });

    it('needs only a name; description, time and cost are optional', async () => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const res = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Free walk' })
        .expect(201);
      const activity = res.body as ActivityView;
      expect(activity.name).toBe('Free walk');
      expect(activity.time).toBeUndefined();
      expect(activity.cost).toBeUndefined();
    });

    it.each([
      ['a missing name', { name: undefined }, 'name'],
      ['an empty name', { name: ' ' }, 'name'],
      ['a name over 100 characters', { name: 'x'.repeat(101) }, 'name'],
      [
        'a description over 1000 characters',
        { description: 'x'.repeat(1001) },
        'description',
      ],
      ['a time that is not HH:mm', { time: '9:5' }, 'time'],
      ['a time past midnight', { time: '24:00' }, 'time'],
      ['a negative cost', { cost: -1 }, 'cost'],
      ['a cost that is not a number', { cost: 'free' }, 'cost'],
      ['a currency that is not a code', { currency: 'dollars' }, 'currency'],
    ])('rejects %s', async (_name, change, field) => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const res = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Ok', ...change })
        .expect(400);
      expect(fieldsOf(res)).toContain(field);
    });

    it('answers 404 for an unknown day and for someone elses itinerary', async () => {
      const owner = await loggedInAs();
      const other = await loggedInAs();
      const { itineraryId, dayId } = await withDay(owner.client);
      await owner.client
        .post(`/api/itineraries/${itineraryId}/days/${someId()}/activities`)
        .send({ name: 'Walk' })
        .expect(404);
      await other.client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Walk' })
        .expect(404);
    });

    it('edits an activity, and null clears an optional field', async () => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const created = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Museum', time: '10:00', cost: 10, currency: 'EGP' })
        .expect(201);
      const id = (created.body as ActivityView).id;

      const edited = await client
        .patch(`/api/activities/${id}`)
        .send({ name: 'Egyptian Museum', cost: 12 })
        .expect(200);
      expect(edited.body).toMatchObject({
        id,
        name: 'Egyptian Museum',
        time: '10:00',
        cost: 12,
      });

      const cleared = await client
        .patch(`/api/activities/${id}`)
        .send({ time: null, cost: null })
        .expect(200);
      const body = cleared.body as ActivityView;
      expect(body.time).toBeUndefined();
      expect(body.cost).toBeUndefined();
      expect(body.name).toBe('Egyptian Museum');
    });

    it('saves nothing when an edit is invalid', async () => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const created = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Museum' })
        .expect(201);
      const id = (created.body as ActivityView).id;
      await client
        .patch(`/api/activities/${id}`)
        .send({ name: 'Renamed', cost: -5 })
        .expect(400);
      const full = await client.get(`/api/itineraries/${itineraryId}`);
      expect((full.body as ItineraryView).days[0].activities[0].name).toBe(
        'Museum',
      );
    });

    it('deletes an activity', async () => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const created = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Museum' })
        .expect(201);
      const id = (created.body as ActivityView).id;
      await client.delete(`/api/activities/${id}`).expect(204);
      const full = await client.get(`/api/itineraries/${itineraryId}`);
      expect((full.body as ItineraryView).days[0].activities).toEqual([]);
      await client.delete(`/api/activities/${id}`).expect(404);
    });

    it('removes a days activities with the day', async () => {
      const { client } = await loggedInAs();
      const { itineraryId, dayId } = await withDay(client);
      const created = await client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Museum' })
        .expect(201);
      await client
        .delete(`/api/itineraries/${itineraryId}/days/${dayId}?confirm=true`)
        .expect(200);
      await client
        .patch(`/api/activities/${(created.body as ActivityView).id}`)
        .send({ name: 'x' })
        .expect(404);
    });

    it("answers 404 for someone else's activity and leaves it alone", async () => {
      const owner = await loggedInAs();
      const other = await loggedInAs();
      const { itineraryId, dayId } = await withDay(owner.client);
      const created = await owner.client
        .post(`/api/itineraries/${itineraryId}/days/${dayId}/activities`)
        .send({ name: 'Museum' })
        .expect(201);
      const id = (created.body as ActivityView).id;
      await other.client
        .patch(`/api/activities/${id}`)
        .send({ name: 'Hacked' })
        .expect(404);
      await other.client.delete(`/api/activities/${id}`).expect(404);
      await owner.client.patch(`/api/activities/${id}`).send({}).expect(200);
      const full = await owner.client.get(`/api/itineraries/${itineraryId}`);
      expect((full.body as ItineraryView).days[0].activities[0].name).toBe(
        'Museum',
      );
    });

    it('answers 404 for an unknown activity and an id that is not an ObjectId', async () => {
      const { client } = await loggedInAs();
      await client.patch(`/api/activities/${someId()}`).send({}).expect(404);
      await client.delete('/api/activities/not-an-id').expect(404);
    });
  });

  describe('admin moderation of itineraries (GEN-10)', () => {
    it('hides an itinerary: still visible to its owner, flagged as hidden', async () => {
      const owner = await loggedInAs();
      const admin = await loggedInAs(Role.ADMIN);
      const created = await createItinerary(owner.client, { title: 'Hide me' });
      const res = await admin.client
        .delete(`/api/admin/content/itinerary/${created.id}`)
        .expect(200);
      expect(res.body).toEqual({
        type: 'itinerary',
        id: created.id,
        mode: 'hide',
      });
      const seen = await owner.client.get(`/api/itineraries/${created.id}`);
      expect((seen.body as ItineraryView).isHidden).toBe(true);
    });

    it('deletes an itinerary and tells the budget module', async () => {
      const removed: string[] = [];
      const spy = useBudgets({
        dayTotals: () => Promise.resolve({ currency: 'EGP', byDay: {} }),
        removeDay: () => Promise.resolve(),
        removeItinerary: (id) => {
          removed.push(id);
          return Promise.resolve();
        },
      });
      try {
        const owner = await loggedInAs();
        const admin = await loggedInAs(Role.ADMIN);
        const created = await createItinerary(owner.client);
        await admin.client
          .delete(`/api/admin/content/itinerary/${created.id}?mode=delete`)
          .expect(200);
        await owner.client.get(`/api/itineraries/${created.id}`).expect(404);
        expect(removed).toEqual([created.id]);
      } finally {
        spy.mockRestore();
      }
    });

    it('answers 404 for an unknown itinerary', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client
        .delete(`/api/admin/content/itinerary/${someId()}`)
        .expect(404);
    });
  });

  // Runs last: once registered, the catalog stays for the rest of the file.
  describe('predefined countries and cities (GEN-12) once the reference data is connected', () => {
    beforeAll(() => {
      places.register({
        isCountry: (code) => Promise.resolve(['EG', 'AE', 'GB'].includes(code)),
        isCity: (id) =>
          Promise.resolve(['cairo', 'dubai', 'london'].includes(id)),
      });
    });

    it('rejects a country that is not in the list', async () => {
      const { client } = await loggedInAs();
      const res = await client
        .post('/api/itineraries')
        .send({
          title: 'Trip',
          countries: ['EG', 'ZZ'],
          startDate: '2027-03-01',
        })
        .expect(400);
      expect(fieldsOf(res)).toContain('countries');
      const created = await createItinerary(client);
      const patch = await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ countries: ['ZZ'] })
        .expect(400);
      expect(fieldsOf(patch)).toContain('countries');
    });

    it('rejects a city that is not in the list', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client);
      const res = await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city: 'atlantis' })
        .expect(400);
      expect(fieldsOf(res)).toContain('city');
      const withDay = await addDay(client, created.id, 'cairo');
      const patch = await client
        .patch(`/api/itineraries/${created.id}/days/${withDay.days[0].id}`)
        .send({ city: 'atlantis' })
        .expect(400);
      expect(fieldsOf(patch)).toContain('city');
    });

    it('accepts countries and cities from the list', async () => {
      const { client } = await loggedInAs();
      const created = await createItinerary(client, { countries: ['GB'] });
      await addDay(client, created.id, 'london');
    });
  });
});
