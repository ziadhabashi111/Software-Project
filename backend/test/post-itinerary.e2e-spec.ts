import { getModelToken } from '@nestjs/mongoose';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { BlogModule } from '../src/blog/blog.module';
import type { PostView } from '../src/blog/post-view';
import type { PublicPostView } from '../src/blog/public-posts.service';
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
  errors?: { field: string; messages: string[] }[];
}
const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

type Agent = ReturnType<typeof request.agent>;

describe('Linking an itinerary to a blog post (BLG-13; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let dir: string;
  let users: UsersService;
  let passwords: PasswordService;
  let itineraryModel: Model<ItineraryDocument>;
  let counter = 0;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'post-itinerary-e2e-'));
    process.env.UPLOAD_DIR = dir;
    process.env.UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads';
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, BlogModule, ItinerariesModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    itineraryModel = ctx.moduleRef.get<Model<ItineraryDocument>>(
      getModelToken(Itinerary.name),
    );
    // The reference-data module is not part of this app: stand in for it.
    ctx.moduleRef.get(PlaceCatalog).register({
      isCountry: () => Promise.resolve(true),
      isCity: () => Promise.resolve(true),
      matchKeyword: () => Promise.resolve({ countryCodes: [], cityIds: [] }),
    });
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
    const email = `link-post${counter}@example.com`;
    const doc = await users.create({
      name: `Post Person ${counter}`,
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

  const guest = () => request(ctx.server);

  async function itineraryOf(
    client: Agent,
    visibility: 'public' | 'private' = 'public',
  ): Promise<string> {
    const created = (
      await client
        .post('/api/itineraries')
        .send({
          title: 'A week in Egypt',
          countries: ['EG'],
          startDate: '2027-03-01',
        })
        .expect(201)
    ).body as { id: string };
    await client
      .post(`/api/itineraries/${created.id}/days`)
      .send({ city: 'cairo' })
      .expect(201);
    if (visibility === 'public') {
      await client
        .patch(`/api/itineraries/${created.id}`)
        .send({ visibility: 'public' })
        .expect(200);
    }
    return created.id;
  }

  async function publishedPost(client: Agent): Promise<string> {
    const res = await client
      .post('/api/posts')
      .send({
        title: 'Egypt trip',
        body: 'It was great.',
        status: 'published',
      })
      .expect(201);
    return (res.body as PostView).id;
  }

  const link = (client: Agent, postId: string, itineraryId: string | null) =>
    client.patch(`/api/posts/${postId}/itinerary`).send({ itineraryId });

  const readerView = async (postId: string) =>
    (await guest().get(`/api/posts/${postId}`).expect(200))
      .body as PublicPostView;

  it('lets the author link their own public itinerary; the author and readers both see it', async () => {
    const author = await loggedInAs();
    const itineraryId = await itineraryOf(author.client);
    const postId = await publishedPost(author.client);

    const res = await link(author.client, postId, itineraryId).expect(200);
    expect((res.body as PostView).itinerary).toEqual({
      id: itineraryId,
      title: 'A week in Egypt',
      countries: ['EG'],
      startDate: '2027-03-01',
      dayCount: 1,
      isPublic: true,
    });

    const mine = (
      await author.client.get(`/api/posts/mine/${postId}`).expect(200)
    ).body as PostView;
    expect(mine.itinerary?.id).toBe(itineraryId);

    // Readers get the summary only, with no visibility fields.
    expect((await readerView(postId)).itinerary).toEqual({
      id: itineraryId,
      title: 'A week in Egypt',
      countries: ['EG'],
      startDate: '2027-03-01',
      dayCount: 1,
    });
  });

  it('shows nothing to readers once the itinerary is private again, but still tells the author', async () => {
    const author = await loggedInAs();
    const itineraryId = await itineraryOf(author.client);
    const postId = await publishedPost(author.client);
    await link(author.client, postId, itineraryId).expect(200);

    await author.client
      .patch(`/api/itineraries/${itineraryId}`)
      .send({ visibility: 'private' })
      .expect(200);

    expect((await readerView(postId)).itinerary).toBeNull();
    const mine = (
      await author.client.get(`/api/posts/mine/${postId}`).expect(200)
    ).body as PostView;
    expect(mine.itinerary).toMatchObject({ id: itineraryId, isPublic: false });

    // Public again: the link works again without being redone.
    await author.client
      .patch(`/api/itineraries/${itineraryId}`)
      .send({ visibility: 'public' })
      .expect(200);
    expect((await readerView(postId)).itinerary?.id).toBe(itineraryId);
  });

  it('hides the itinerary from readers while a moderator has hidden it', async () => {
    const author = await loggedInAs();
    const itineraryId = await itineraryOf(author.client);
    const postId = await publishedPost(author.client);
    await link(author.client, postId, itineraryId).expect(200);

    await itineraryModel.updateOne({ _id: itineraryId }, { isHidden: true });
    expect((await readerView(postId)).itinerary).toBeNull();
    const mine = (
      await author.client.get(`/api/posts/mine/${postId}`).expect(200)
    ).body as PostView;
    expect(mine.itinerary?.isPublic).toBe(false);
  });

  it('shows no itinerary once it has been deleted, and the post still works', async () => {
    const author = await loggedInAs();
    const itineraryId = await itineraryOf(author.client);
    const postId = await publishedPost(author.client);
    await link(author.client, postId, itineraryId).expect(200);

    await itineraryModel.deleteOne({ _id: itineraryId });
    expect((await readerView(postId)).itinerary).toBeNull();
    const mine = (
      await author.client.get(`/api/posts/mine/${postId}`).expect(200)
    ).body as PostView;
    expect(mine.itinerary).toBeNull();
  });

  it('removes the link with null', async () => {
    const author = await loggedInAs();
    const itineraryId = await itineraryOf(author.client);
    const postId = await publishedPost(author.client);
    await link(author.client, postId, itineraryId).expect(200);

    const res = await link(author.client, postId, null).expect(200);
    expect((res.body as PostView).itinerary).toBeNull();
    expect((await readerView(postId)).itinerary).toBeNull();
  });

  it('links a draft post too; only readers of a published post ever see it', async () => {
    const author = await loggedInAs();
    const itineraryId = await itineraryOf(author.client);
    const draft = (
      await author.client
        .post('/api/posts')
        .send({ title: 'Draft', body: 'Soon.' })
        .expect(201)
    ).body as PostView;
    const res = await link(author.client, draft.id, itineraryId).expect(200);
    expect((res.body as PostView).itinerary?.id).toBe(itineraryId);
    await guest().get(`/api/posts/${draft.id}`).expect(404);
  });

  describe('what cannot be linked', () => {
    it('refuses a private itinerary with a field error', async () => {
      const author = await loggedInAs();
      const itineraryId = await itineraryOf(author.client, 'private');
      const postId = await publishedPost(author.client);
      const res = await link(author.client, postId, itineraryId).expect(400);
      expect(fieldsOf(res)).toContain('itineraryId');
      expect((await readerView(postId)).itinerary).toBeNull();
    });

    it('refuses an itinerary a moderator has hidden', async () => {
      const author = await loggedInAs();
      const itineraryId = await itineraryOf(author.client);
      await itineraryModel.updateOne({ _id: itineraryId }, { isHidden: true });
      const postId = await publishedPost(author.client);
      await link(author.client, postId, itineraryId).expect(400);
    });

    // Someone else's itinerary looks exactly like one that does not exist.
    it("answers 404 for someone else's public itinerary and for an unknown one", async () => {
      const author = await loggedInAs();
      const other = await loggedInAs();
      const othersItinerary = await itineraryOf(other.client);
      const postId = await publishedPost(author.client);
      await link(author.client, postId, othersItinerary).expect(404);
      await link(author.client, postId, new Types.ObjectId().toString()).expect(
        404,
      );
      expect((await readerView(postId)).itinerary).toBeNull();
    });

    it('rejects a malformed or missing itineraryId', async () => {
      const author = await loggedInAs();
      const postId = await publishedPost(author.client);
      const bad = await link(author.client, postId, 'not-an-id').expect(400);
      expect(fieldsOf(bad)).toContain('itineraryId');
      await author.client
        .patch(`/api/posts/${postId}/itinerary`)
        .send({})
        .expect(400);
    });
  });

  describe('who may link', () => {
    it("is only for the post's author: 403 on a published post, 404 on a draft", async () => {
      const author = await loggedInAs();
      const stranger = await loggedInAs();
      const strangersItinerary = await itineraryOf(stranger.client);
      const published = await publishedPost(author.client);
      const draft = (
        await author.client
          .post('/api/posts')
          .send({ title: 'Draft', body: 'Soon.' })
          .expect(201)
      ).body as PostView;
      await link(stranger.client, published, strangersItinerary).expect(403);
      await link(stranger.client, draft.id, strangersItinerary).expect(404);
      expect((await readerView(published)).itinerary).toBeNull();
    });

    it('needs sign-in and a regular user', async () => {
      const author = await loggedInAs();
      const admin = await loggedInAs(Role.ADMIN);
      const itineraryId = await itineraryOf(author.client);
      const postId = await publishedPost(author.client);
      await guest()
        .patch(`/api/posts/${postId}/itinerary`)
        .send({ itineraryId })
        .expect(401);
      await link(admin.client, postId, itineraryId).expect(403);
    });
  });
});
