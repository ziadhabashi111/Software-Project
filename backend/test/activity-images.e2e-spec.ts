import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

interface ErrorBody {
  errors?: { field: string; messages: string[] }[];
}

interface ActivityView {
  id: string;
  name: string;
  images: { id: string; url: string }[];
}

interface ItineraryView {
  id: string;
  days: { id: string; activities: ActivityView[] }[];
}

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

type Agent = ReturnType<typeof request.agent>;

describe('Activity images (ITN-12, GEN-08; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let dir: string;
  let users: UsersService;
  let passwords: PasswordService;
  let counter = 0;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'activity-images-e2e-'));
    process.env.UPLOAD_DIR = dir;
    process.env.UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads';
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, ItinerariesModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
    delete process.env.UPLOAD_DIR;
    delete process.env.UPLOAD_PUBLIC_URL;
    await rm(dir, { recursive: true, force: true });
  });

  async function loggedInAs(
    role: Role = Role.USER,
  ): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `pictures${counter}@example.com`;
    const doc = await users.create({
      name: `Picture Taker ${counter}`,
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

  /** A fresh itinerary with one day and one activity. */
  async function withActivity(client: Agent) {
    const created = (
      await client
        .post('/api/itineraries')
        .send({ title: 'Pictures', countries: ['EG'], startDate: '2027-03-01' })
        .expect(201)
    ).body as ItineraryView;
    const day = (
      await client
        .post(`/api/itineraries/${created.id}/days`)
        .send({ city: 'cairo' })
        .expect(201)
    ).body as ItineraryView;
    const dayId = day.days[0].id;
    const activity = (
      await client
        .post(`/api/itineraries/${created.id}/days/${dayId}/activities`)
        .send({ name: 'Pyramids' })
        .expect(201)
    ).body as ActivityView;
    return { itineraryId: created.id, dayId, activityId: activity.id };
  }

  const upload = (client: Agent, activityId: string, files: Buffer[]) => {
    const req = client.post(`/api/activities/${activityId}/images`);
    for (const [index, file] of files.entries()) {
      req.attach('images', file, `p${index}.png`);
    }
    return req;
  };

  const filesOnDisk = async (): Promise<string[]> =>
    (await readdir(dir)).sort();
  const nameOf = (url: string): string => url.split('/').pop() as string;

  it('needs a login', async () => {
    await request(ctx.server)
      .post('/api/activities/665f1c2a9b1e8a0012345670/images')
      .attach('images', PNG, 'a.png')
      .expect(401);
    await request(ctx.server)
      .delete(
        '/api/activities/665f1c2a9b1e8a0012345670/images/665f1c2a9b1e8a0012345671',
      )
      .expect(401);
  });

  it('adds JPG and PNG images to an activity and shows them on the itinerary', async () => {
    const me = await loggedInAs();
    const { itineraryId, activityId } = await withActivity(me.client);

    const res = await upload(me.client, activityId, [PNG, JPG]).expect(201);
    const view = res.body as ActivityView;
    expect(view.images).toHaveLength(2);
    expect(view.images[0].url).toMatch(
      /^http:\/\/localhost:3000\/uploads\/[0-9a-f-]{36}\.png$/,
    );
    expect(view.images[1].url).toMatch(/\.jpg$/);
    const names = view.images.map((i) => nameOf(i.url));
    expect(await filesOnDisk()).toEqual(expect.arrayContaining(names));

    const itinerary = (
      await me.client.get(`/api/itineraries/${itineraryId}`).expect(200)
    ).body as ItineraryView;
    expect(itinerary.days[0].activities[0].images.map((i) => i.url)).toEqual(
      view.images.map((i) => i.url),
    );
  });

  it('allows 5 images per activity in total and stores nothing for a 6th', async () => {
    const me = await loggedInAs();
    const { activityId } = await withActivity(me.client);
    await upload(me.client, activityId, [PNG, PNG, PNG]).expect(201);
    await upload(me.client, activityId, [PNG, PNG]).expect(201);
    const before = await filesOnDisk();

    const res = await upload(me.client, activityId, [PNG]).expect(400);
    expect(fieldsOf(res)).toContain('images');
    expect(await filesOnDisk()).toEqual(before);
  });

  it('rejects a file that is not really a JPG or PNG, and a request with no file', async () => {
    const me = await loggedInAs();
    const { activityId } = await withActivity(me.client);
    const before = await filesOnDisk();

    const fake = await me.client
      .post(`/api/activities/${activityId}/images`)
      .attach('images', Buffer.from('<script>alert(1)</script>'), 'x.png')
      .expect(400);
    expect(fieldsOf(fake)).toContain('images');
    await me.client.post(`/api/activities/${activityId}/images`).expect(400);
    expect(await filesOnDisk()).toEqual(before);
  });

  it('answers 404 for someone else’s activity and stores nothing', async () => {
    const owner = await loggedInAs();
    const other = await loggedInAs();
    const { activityId } = await withActivity(owner.client);
    const before = await filesOnDisk();

    await upload(other.client, activityId, [PNG]).expect(404);
    expect(await filesOnDisk()).toEqual(before);

    const res = await upload(owner.client, activityId, [PNG]).expect(201);
    const [image] = (res.body as ActivityView).images;
    await other.client
      .delete(`/api/activities/${activityId}/images/${image.id}`)
      .expect(404);
    expect(await filesOnDisk()).toContain(nameOf(image.url));
  });

  it('removes one image and deletes its file; an unknown image is a 404', async () => {
    const me = await loggedInAs();
    const { activityId } = await withActivity(me.client);
    const added = (await upload(me.client, activityId, [PNG, PNG]).expect(201))
      .body as ActivityView;
    const [first, second] = added.images;

    const res = await me.client
      .delete(`/api/activities/${activityId}/images/${first.id}`)
      .expect(200);
    expect((res.body as ActivityView).images.map((i) => i.id)).toEqual([
      second.id,
    ]);
    const files = await filesOnDisk();
    expect(files).not.toContain(nameOf(first.url));
    expect(files).toContain(nameOf(second.url));

    await me.client
      .delete(`/api/activities/${activityId}/images/${first.id}`)
      .expect(404);
  });

  describe('files are deleted with whatever held them', () => {
    async function withTwoImages() {
      const me = await loggedInAs();
      const ids = await withActivity(me.client);
      const added = (
        await upload(me.client, ids.activityId, [PNG, JPG]).expect(201)
      ).body as ActivityView;
      return { me, ...ids, names: added.images.map((i) => nameOf(i.url)) };
    }
    const noneLeft = async (names: string[]) =>
      expect(await filesOnDisk()).not.toEqual(
        expect.arrayContaining([names[0]]),
      );

    it('an activity', async () => {
      const { me, activityId, names } = await withTwoImages();
      await me.client.delete(`/api/activities/${activityId}`).expect(204);
      const files = await filesOnDisk();
      names.forEach((name) => expect(files).not.toContain(name));
    });

    it('a day', async () => {
      const { me, itineraryId, dayId, names } = await withTwoImages();
      await me.client
        .delete(`/api/itineraries/${itineraryId}/days/${dayId}?confirm=true`)
        .expect(200);
      const files = await filesOnDisk();
      names.forEach((name) => expect(files).not.toContain(name));
    });

    it('the whole itinerary', async () => {
      const { me, itineraryId, names } = await withTwoImages();
      await me.client
        .delete(`/api/itineraries/${itineraryId}?confirm=true`)
        .expect(204);
      const files = await filesOnDisk();
      names.forEach((name) => expect(files).not.toContain(name));
      await noneLeft(names);
    });

    it('an itinerary deleted by an admin', async () => {
      const { itineraryId, names } = await withTwoImages();
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client
        .delete(`/api/admin/content/itinerary/${itineraryId}?mode=delete`)
        .expect(200);
      const files = await filesOnDisk();
      names.forEach((name) => expect(files).not.toContain(name));
    });
  });

  it('never goes over 5 images, nor leaves a stray file, when uploads arrive together', async () => {
    const me = await loggedInAs();
    const { itineraryId, activityId } = await withActivity(me.client);
    const before = await filesOnDisk();

    const results = await Promise.all(
      [0, 1, 2, 3].map(() => upload(me.client, activityId, [PNG, PNG])),
    );
    expect(results.some((r) => r.status === 201)).toBe(true);
    results
      .filter((r) => r.status !== 201)
      .forEach((r) => expect(r.status).toBe(400));

    const itinerary = (
      await me.client.get(`/api/itineraries/${itineraryId}`).expect(200)
    ).body as ItineraryView;
    const images = itinerary.days[0].activities[0].images;
    expect(images.length).toBeLessThanOrEqual(5);

    const added = (await filesOnDisk()).filter((f) => !before.includes(f));
    expect(added.sort()).toEqual(images.map((i) => nameOf(i.url)).sort());
  });
});
