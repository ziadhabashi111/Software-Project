import { getModelToken } from '@nestjs/mongoose';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { PasswordService } from '../src/auth/password.service';
import { BlogModule } from '../src/blog/blog.module';
import type { MyPostRow, PostView, PublicPostRow } from '../src/blog/post-view';
import { Comment } from '../src/blog/schemas/comment.schema';
import { Post } from '../src/blog/schemas/post.schema';
import type { Paginated } from '../src/common/pagination/pagination';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 3]);

interface ErrorBody {
  errors?: { field: string; messages: string[] }[];
}
const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);
const messagesOf = (res: request.Response): string =>
  ((res.body as ErrorBody).errors ?? []).flatMap((e) => e.messages).join(' ');

type Agent = ReturnType<typeof request.agent>;

describe('Blog posts, drafts, tags and images (BLG-01, 03, 04, 08, 10)', () => {
  let ctx: TestApp;
  let dir: string;
  let users: UsersService;
  let passwords: PasswordService;
  let posts: Model<Post>;
  let comments: Model<Comment>;
  let counter = 0;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'posts-e2e-'));
    process.env.UPLOAD_DIR = dir;
    process.env.UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads';
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, BlogModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    posts = ctx.moduleRef.get(getModelToken(Post.name));
    comments = ctx.moduleRef.get(getModelToken(Comment.name));
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
    delete process.env.UPLOAD_DIR;
    delete process.env.UPLOAD_PUBLIC_URL;
    await rm(dir, { recursive: true, force: true });
  });

  async function author(name?: string): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `author${counter}@example.com`;
    const doc = await users.create({
      name: name ?? `Author ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: doc.id, client };
  }

  async function createPost(
    client: Agent,
    body: Record<string, unknown> = {},
  ): Promise<PostView> {
    const res = await client
      .post('/api/posts')
      .send({
        title: 'Three days in Cairo',
        body: 'Pyramids and food.',
        ...body,
      })
      .expect(201);
    return res.body as PostView;
  }

  const upload = (client: Agent, postId: string, count: number) => {
    let req = client.post(`/api/posts/${postId}/images`);
    for (let i = 0; i < count; i++) req = req.attach('images', PNG, `${i}.png`);
    return req;
  };

  it('requires sign-in for the author routes', async () => {
    await request(ctx.server)
      .post('/api/posts')
      .send({ title: 'x', body: 'y' })
      .expect(401);
    await request(ctx.server).get('/api/posts/mine').expect(401);
  });

  describe('POST /api/posts (BLG-01, BLG-08)', () => {
    it('saves a draft by default and a published post with its publish date', async () => {
      const { client } = await author();
      const draft = await createPost(client);
      expect(draft).toMatchObject({
        title: 'Three days in Cairo',
        status: 'draft',
        publishedAt: null,
        tags: [],
        images: [],
        likeCount: 0,
        commentCount: 0,
      });

      const published = await createPost(client, { status: 'published' });
      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();
    });

    it('stores up to 5 tags lower-case without duplicates', async () => {
      const { client } = await author();
      const post = await createPost(client, {
        tags: ['Cairo', ' cairo ', 'FOOD', 'egypt'],
      });
      expect(post.tags).toEqual(['cairo', 'food', 'egypt']);
    });

    it('validates title, body, tags, status and image URLs field by field', async () => {
      const { client } = await author();
      const cases: [Record<string, unknown>, string][] = [
        [{ body: 'text' }, 'title'],
        [{ title: '   ', body: 'text' }, 'title'],
        [{ title: 'x'.repeat(151), body: 'text' }, 'title'],
        [{ title: 'Title' }, 'body'],
        [{ title: 'Title', body: '   ' }, 'body'],
        [
          { title: 'T', body: 'b', tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
          'tags',
        ],
        [{ title: 'T', body: 'b', tags: ['x'.repeat(31)] }, 'tags'],
        [{ title: 'T', body: 'b', tags: ['  '] }, 'tags'],
        [{ title: 'T', body: 'b', status: 'archived' }, 'status'],
        [
          { title: 'T', body: 'b', imageUrls: ['https://evil.test/x.png'] },
          'imageUrls',
        ],
      ];
      for (const [body, field] of cases) {
        const res = await client.post('/api/posts').send(body).expect(400);
        expect(fieldsOf(res)).toContain(field);
      }
    });

    it('accepts image URLs returned by the upload helper', async () => {
      const { client } = await author();
      const uploaded = await client
        .post('/api/uploads/images')
        .attach('images', PNG, 'a.png')
        .expect(201);
      const [image] = (uploaded.body as { images: { url: string }[] }).images;
      const post = await createPost(client, { imageUrls: [image.url] });
      expect(post.images.map((i) => i.url)).toEqual([image.url]);
    });

    it("rejects another author's uploaded image: only the uploader can attach it (GEN-08)", async () => {
      const owner = await author();
      const other = await author();
      const uploaded = await owner.client
        .post('/api/uploads/images')
        .attach('images', PNG, 'a.png')
        .expect(201);
      const [image] = (uploaded.body as { images: { url: string }[] }).images;
      const res = await other.client
        .post('/api/posts')
        .send({ title: 'Reusing it', body: 'b', imageUrls: [image.url] })
        .expect(400);
      expect(fieldsOf(res)).toContain('imageUrls');
    });
  });

  describe('GET /api/posts/mine (BLG-03)', () => {
    it('lists only my posts, drafts included, newest first, with counts', async () => {
      const me = await author();
      const other = await author();
      const first = await createPost(me.client, { title: 'First' });
      const second = await createPost(me.client, {
        title: 'Second',
        status: 'published',
      });
      await createPost(other.client, { title: 'Not mine' });
      await posts.updateOne(
        { _id: second.id },
        { $set: { likeCount: 4, commentCount: 2 } },
      );

      const res = await me.client.get('/api/posts/mine').expect(200);
      const page = res.body as Paginated<MyPostRow>;
      expect(page.total).toBe(2);
      expect(page.items.map((p) => p.title)).toEqual(['Second', 'First']);
      expect(page.items[0]).toMatchObject({
        status: 'published',
        likeCount: 4,
        commentCount: 2,
      });
      expect(page.items[1]).toMatchObject({ id: first.id, status: 'draft' });

      const drafts = await me.client
        .get('/api/posts/mine?status=draft')
        .expect(200);
      expect((drafts.body as Paginated<MyPostRow>).total).toBe(1);

      await me.client.get(`/api/posts/mine/${first.id}`).expect(200);
      await other.client.get(`/api/posts/mine/${first.id}`).expect(404);
    });
  });

  describe('PATCH and DELETE /api/posts/:id (BLG-04)', () => {
    it('lets the author edit and publish; others get 403 or 404', async () => {
      const me = await author();
      const other = await author();
      const draft = await createPost(me.client);

      const edited = await me.client
        .patch(`/api/posts/${draft.id}`)
        .send({ title: 'Updated', tags: ['Nile'], status: 'published' })
        .expect(200);
      const view = edited.body as PostView;
      expect(view).toMatchObject({
        title: 'Updated',
        tags: ['nile'],
        status: 'published',
      });
      expect(view.publishedAt).not.toBeNull();

      // Back to draft keeps the first publish date.
      const back = await me.client
        .patch(`/api/posts/${draft.id}`)
        .send({ status: 'draft' })
        .expect(200);
      expect((back.body as PostView).publishedAt).toBe(view.publishedAt);

      // A draft of someone else is not revealed; a published one is 403.
      await other.client
        .patch(`/api/posts/${draft.id}`)
        .send({ title: 'Hijack' })
        .expect(404);
      await me.client
        .patch(`/api/posts/${draft.id}`)
        .send({ status: 'published' })
        .expect(200);
      await other.client
        .patch(`/api/posts/${draft.id}`)
        .send({ title: 'Hijack' })
        .expect(403);
      await other.client.delete(`/api/posts/${draft.id}`).expect(403);

      const invalid = await me.client
        .patch(`/api/posts/${draft.id}`)
        .send({ title: '' })
        .expect(400);
      expect(fieldsOf(invalid)).toContain('title');
      await me.client
        .patch(`/api/posts/${draft.id}`)
        .send({ imageUrls: [] })
        .expect(400);
      await me.client
        .patch(`/api/posts/${new Types.ObjectId().toHexString()}`)
        .send({ title: 'x' })
        .expect(404);
    });

    it('deletes the post with its comments and images', async () => {
      const me = await author();
      const post = await createPost(me.client, { status: 'published' });
      await upload(me.client, post.id, 1).expect(201);
      await comments.create({
        post: new Types.ObjectId(post.id),
        author: new Types.ObjectId(me.id),
        body: 'Nice',
      });
      const filesBefore = (await readdir(dir)).length;

      await me.client.delete(`/api/posts/${post.id}`).expect(204);
      expect(await posts.exists({ _id: post.id })).toBeNull();
      expect(await comments.countDocuments({ post: post.id })).toBe(0);
      expect((await readdir(dir)).length).toBe(filesBefore - 1);
      await me.client.delete(`/api/posts/${post.id}`).expect(404);
    });
  });

  describe('Images (BLG-10, GEN-08)', () => {
    it('allows at most 5 images per post and removes them with their files', async () => {
      const me = await author();
      const other = await author();
      const post = await createPost(me.client);

      const two = await upload(me.client, post.id, 2).expect(201);
      expect((two.body as PostView).images).toHaveLength(2);

      const tooMany = await upload(me.client, post.id, 4).expect(400);
      expect(messagesOf(tooMany)).toMatch(/you can add 3 more/);

      const five = await upload(me.client, post.id, 3).expect(201);
      const images = (five.body as PostView).images;
      expect(images).toHaveLength(5);
      await upload(me.client, post.id, 1).expect(400);

      await upload(other.client, post.id, 1).expect(404); // someone else's draft

      const removed = await me.client
        .delete(`/api/posts/${post.id}/images/${images[0].id}`)
        .expect(200);
      expect((removed.body as PostView).images).toHaveLength(4);
      expect(await readdir(dir)).not.toContain(images[0].url.split('/').pop());
      await me.client
        .delete(`/api/posts/${post.id}/images/${images[0].id}`)
        .expect(404);
    });

    it('never passes 5 images when uploads run in parallel', async () => {
      const me = await author();
      const post = await createPost(me.client);
      await upload(me.client, post.id, 4).expect(201);

      const results = await Promise.all([
        upload(me.client, post.id, 1),
        upload(me.client, post.id, 1),
        upload(me.client, post.id, 1),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await posts.findById(post.id))?.images).toHaveLength(5);
    });
  });

  describe('GET /api/tags/:tag/posts (BLG-08)', () => {
    it('lists published, visible posts with the tag for everyone', async () => {
      const me = await author('Tag Author');
      const shown = await createPost(me.client, {
        title: 'Shown',
        tags: ['Dubai'],
        status: 'published',
        body: 'A '.repeat(300),
      });
      await createPost(me.client, { title: 'Draft', tags: ['dubai'] });
      const hidden = await createPost(me.client, {
        title: 'Hidden',
        tags: ['dubai'],
        status: 'published',
      });
      await posts.updateOne({ _id: hidden.id }, { $set: { isHidden: true } });

      const res = await request(ctx.server)
        .get('/api/tags/DUBAI/posts')
        .expect(200);
      const page = res.body as Paginated<PublicPostRow>;
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        id: shown.id,
        title: 'Shown',
        author: { id: me.id, name: 'Tag Author' },
        tags: ['dubai'],
      });
      expect(page.items[0].excerpt.length).toBeLessThanOrEqual(200);

      const none = await request(ctx.server)
        .get('/api/tags/nothing-here/posts')
        .expect(200);
      expect((none.body as Paginated<PublicPostRow>).total).toBe(0);
    });
  });
});
