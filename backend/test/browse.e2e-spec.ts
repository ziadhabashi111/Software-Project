import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { AuthorItineraries } from '../src/blog/author-itineraries';
import { BlogModule } from '../src/blog/blog.module';
import type { PublicPostRow } from '../src/blog/post-view';
import type {
  AuthorPageView,
  PublicPostView,
} from '../src/blog/public-posts.service';
import { Post, PostStatus } from '../src/blog/schemas/post.schema';
import type { Paginated } from '../src/common/pagination/pagination';
import { User } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
type Agent = ReturnType<typeof request.agent>;

describe('Browse, search, post page and author page (BLG-02, BLG-09, BLG-12)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let posts: Model<Post>;
  let userModel: Model<User>;
  let counter = 0;
  let minute = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, BlogModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    posts = ctx.moduleRef.get(getModelToken(Post.name));
    userModel = ctx.moduleRef.get(getModelToken(User.name));
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await posts.deleteMany({});
  });

  const api = () => request(ctx.server);

  async function member(
    name?: string,
    role: Role = Role.USER,
  ): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `browse${counter}@example.com`;
    const doc = await users.create({
      name: name ?? `Writer ${counter}`,
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

  /** Each post is published one minute after the previous one. */
  async function post(
    authorId: string,
    overrides: Partial<Post> = {},
  ): Promise<string> {
    minute += 1;
    const doc = await posts.create({
      author: new Types.ObjectId(authorId),
      title: `Post ${minute}`,
      body: 'Some travel notes.',
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(Date.UTC(2026, 10, 1, 0, minute)),
      ...overrides,
    });
    return doc.id;
  }

  const deactivate = (id: string) =>
    userModel.updateOne(
      { _id: id },
      { $set: { status: UserStatus.DEACTIVATED } },
    );

  const titles = (res: request.Response) =>
    (res.body as Paginated<PublicPostRow>).items.map((p) => p.title);

  describe('GET /api/posts (BLG-02)', () => {
    it('shows published, visible posts newest first, filterable by tag', async () => {
      const writer = await member('Browse Writer');
      const gone = await member();
      await post(writer.id, { title: 'Old', tags: ['cairo'] });
      await post(writer.id, { title: 'New', tags: ['food'] });
      await post(writer.id, { title: 'Draft', status: PostStatus.DRAFT });
      await post(writer.id, { title: 'Hidden', isHidden: true });
      await post(gone.id, { title: 'Deactivated author' });
      await deactivate(gone.id);

      const all = await api().get('/api/posts').expect(200);
      expect(titles(all)).toEqual(['New', 'Old']);
      expect((all.body as Paginated<PublicPostRow>).items[0]).toMatchObject({
        author: { id: writer.id, name: 'Browse Writer' },
        tags: ['food'],
      });

      const tagged = await api().get('/api/posts?tag=CAIRO').expect(200);
      expect(titles(tagged)).toEqual(['Old']);

      // The tag page uses the same rules (ACC-12 included).
      const tagPage = await api().get('/api/tags/cairo/posts').expect(200);
      expect(titles(tagPage)).toEqual(['Old']);
    });

    it('paginates with 10 per page by default', async () => {
      const writer = await member();
      for (let i = 0; i < 12; i++) await post(writer.id);
      const first = await api().get('/api/posts').expect(200);
      expect(first.body).toMatchObject({ total: 12, page: 1, limit: 10 });
      expect((first.body as Paginated<PublicPostRow>).items).toHaveLength(10);
      const second = await api().get('/api/posts?page=2').expect(200);
      expect((second.body as Paginated<PublicPostRow>).items).toHaveLength(2);
    });
  });

  describe('GET /api/posts/search (BLG-09)', () => {
    it('matches title, tags or author name, ordered by likes + comments then newest', async () => {
      const nora = await member('Nora Pyramid');
      const other = await member('Someone Else');
      await post(other.id, {
        title: 'Pyramids at dawn',
        likeCount: 1,
        commentCount: 1,
      }); // score 2, older
      await post(other.id, {
        title: 'Desert trip',
        tags: ['pyramids'],
        likeCount: 5,
      }); // score 5
      await post(nora.id, { title: 'My notes' }); // author name match, score 0
      await post(other.id, { title: 'Giza PYRAMIDS', commentCount: 2 }); // score 2, newer
      await post(other.id, { title: 'Beaches' }); // no match

      const res = await api().get('/api/posts/search?q=pyramid').expect(200);
      expect(titles(res)).toEqual([
        'Desert trip',
        'Giza PYRAMIDS',
        'Pyramids at dawn',
        'My notes',
      ]);
      const first = (res.body as Paginated<PublicPostRow>).items[0];
      expect(first.excerpt).toBe('Some travel notes.');
    });

    it('returns an empty list for no results and validates the keyword', async () => {
      const writer = await member();
      await post(writer.id, { title: 'Dubai' });
      const none = await api()
        .get('/api/posts/search?q=antarctica')
        .expect(200);
      expect(none.body).toMatchObject({ items: [], total: 0 });

      await api().get('/api/posts/search').expect(400);
      await api().get('/api/posts/search?q=%20%20').expect(400);
      // Regex characters are treated as text.
      await api().get('/api/posts/search?q=c%2B%2B(').expect(200);
    });

    it('never returns drafts, hidden posts or posts of deactivated authors', async () => {
      const writer = await member();
      const gone = await member('Gone Traveller');
      await post(writer.id, { title: 'Nile draft', status: PostStatus.DRAFT });
      await post(writer.id, { title: 'Nile hidden', isHidden: true });
      await post(gone.id, { title: 'Nile cruise' });
      await deactivate(gone.id);
      const res = await api().get('/api/posts/search?q=nile').expect(200);
      expect((res.body as Paginated<PublicPostRow>).total).toBe(0);
    });
  });

  describe('GET /api/posts/:id (BLG-02)', () => {
    it('shows the full post with comments; likedByMe for signed-in users', async () => {
      const writer = await member('Page Writer');
      const fan = await member();
      const id = await post(writer.id, {
        tags: ['tokyo'],
        body: 'Senso-ji at night.',
      });
      await fan.client.post(`/api/posts/${id}/like`).expect(200);
      await fan.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'Lovely' })
        .expect(201);

      const guest = await api().get(`/api/posts/${id}`).expect(200);
      expect(guest.body as PublicPostView).toMatchObject({
        id,
        author: { id: writer.id, name: 'Page Writer' },
        body: 'Senso-ji at night.',
        tags: ['tokyo'],
        images: [],
        likeCount: 1,
        commentCount: 1,
        likedByMe: null,
        comments: { total: 1, items: [{ body: 'Lovely' }] },
      });

      const asFan = await fan.client.get(`/api/posts/${id}`).expect(200);
      expect((asFan.body as PublicPostView).likedByMe).toBe(true);
      const asWriter = await writer.client.get(`/api/posts/${id}`).expect(200);
      expect((asWriter.body as PublicPostView).likedByMe).toBe(false);
    });

    it('shows drafts only to the author and hidden posts to the author and admins', async () => {
      const writer = await member();
      const reader = await member();
      const admin = await member('Admin', Role.ADMIN);
      const draft = await post(writer.id, { status: PostStatus.DRAFT });
      const hidden = await post(writer.id, { isHidden: true });

      await writer.client.get(`/api/posts/${draft}`).expect(200);
      await reader.client.get(`/api/posts/${draft}`).expect(404);
      await admin.client.get(`/api/posts/${draft}`).expect(404);
      await api().get(`/api/posts/${draft}`).expect(404);

      await writer.client.get(`/api/posts/${hidden}`).expect(200);
      await admin.client.get(`/api/posts/${hidden}`).expect(200);
      await reader.client.get(`/api/posts/${hidden}`).expect(404);
      await api().get(`/api/posts/${hidden}`).expect(404);

      await api()
        .get(`/api/posts/${new Types.ObjectId().toHexString()}`)
        .expect(404);
      await api().get('/api/posts/not-an-id').expect(404);
    });

    it('hides posts of deactivated authors (ACC-12) except from admins', async () => {
      const gone = await member();
      const admin = await member('Admin', Role.ADMIN);
      const id = await post(gone.id);
      await deactivate(gone.id);
      await api().get(`/api/posts/${id}`).expect(404);
      const asAdmin = await admin.client.get(`/api/posts/${id}`).expect(200);
      expect((asAdmin.body as PublicPostView).author.name).toBe('Deleted user');
    });

    it('keeps GET /api/posts/mine working next to /api/posts/:id', async () => {
      const writer = await member();
      await post(writer.id, { status: PostStatus.DRAFT });
      const mine = await writer.client.get('/api/posts/mine').expect(200);
      expect((mine.body as Paginated<unknown>).total).toBe(1);
    });
  });

  describe('GET /api/authors/:id (BLG-12)', () => {
    it('shows name, join date, published posts and public itineraries', async () => {
      const writer = await member('Author Page');
      await post(writer.id, { title: 'Published one' });
      await post(writer.id, { title: 'A draft', status: PostStatus.DRAFT });
      await post(writer.id, { title: 'Hidden one', isHidden: true });

      const res = await api().get(`/api/authors/${writer.id}`).expect(200);
      const page = res.body as AuthorPageView;
      expect(page).toMatchObject({ id: writer.id, name: 'Author Page' });
      expect(new Date(page.joinedAt).getTime()).not.toBeNaN();
      expect(page.posts.items.map((p) => p.title)).toEqual(['Published one']);
      expect(page.itineraries).toEqual({ items: [], total: 0 });
    });

    it('lists public itineraries once the itinerary module registers its source', async () => {
      const writer = await member();
      const asked: string[] = [];
      ctx.moduleRef.get(AuthorItineraries).register({
        publicForAuthor: (authorId) => {
          asked.push(authorId);
          return Promise.resolve({
            items: [
              {
                id: new Types.ObjectId().toHexString(),
                title: 'Egypt in a week',
                countries: ['EG'],
                startDate: '2026-12-01',
                dayCount: 7,
              },
            ],
            total: 1,
          });
        },
      });
      const res = await api().get(`/api/authors/${writer.id}`).expect(200);
      expect((res.body as AuthorPageView).itineraries.items[0].title).toBe(
        'Egypt in a week',
      );
      expect(asked).toEqual([writer.id]);
    });

    it('answers 404 for unknown or deactivated authors', async () => {
      const gone = await member();
      await deactivate(gone.id);
      await api().get(`/api/authors/${gone.id}`).expect(404);
      await api()
        .get(`/api/authors/${new Types.ObjectId().toHexString()}`)
        .expect(404);
      await api().get('/api/authors/nope').expect(404);
    });
  });
});
