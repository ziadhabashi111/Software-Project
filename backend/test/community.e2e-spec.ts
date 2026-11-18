import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { BlogModule } from '../src/blog/blog.module';
import type { CommentView } from '../src/blog/comments.service';
import type { LikeState } from '../src/blog/likes.service';
import { Like } from '../src/blog/schemas/like.schema';
import { Post, PostStatus } from '../src/blog/schemas/post.schema';
import type { Paginated } from '../src/common/pagination/pagination';
import { User } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  code?: string;
  errors?: { field: string; messages: string[] }[];
}
const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

type Agent = ReturnType<typeof request.agent>;

describe('Comments and likes (BLG-05, BLG-06, BLG-07)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let posts: Model<Post>;
  let likes: Model<Like>;
  let userModel: Model<User>;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, BlogModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    posts = ctx.moduleRef.get(getModelToken(Post.name));
    likes = ctx.moduleRef.get(getModelToken(Like.name));
    userModel = ctx.moduleRef.get(getModelToken(User.name));
    await likes.syncIndexes();
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function member(
    role: Role = Role.USER,
    name?: string,
  ): Promise<{ id: string; client: Agent }> {
    counter += 1;
    const email = `community${counter}@example.com`;
    const doc = await users.create({
      name: name ?? `Member ${counter}`,
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

  async function post(
    authorId: string,
    overrides: Partial<Post> = {},
  ): Promise<string> {
    const doc = await posts.create({
      author: new Types.ObjectId(authorId),
      title: 'Riyadh in winter',
      body: 'Kingdom Centre and food.',
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
      ...overrides,
    });
    return doc.id;
  }

  const countsOf = async (id: string) => {
    const doc = await posts.findById(id);
    return { likes: doc?.likeCount, comments: doc?.commentCount };
  };

  describe('Likes (BLG-06)', () => {
    it('likes once per user, counts and removes the like', async () => {
      const author = await member();
      const a = await member();
      const b = await member();
      const id = await post(author.id);

      await request(ctx.server).post(`/api/posts/${id}/like`).expect(401);

      const first = await a.client.post(`/api/posts/${id}/like`).expect(200);
      expect(first.body as LikeState).toEqual({
        postId: id,
        liked: true,
        likeCount: 1,
      });
      const again = await a.client.post(`/api/posts/${id}/like`).expect(409);
      expect((again.body as ErrorBody).code).toBe('ALREADY_LIKED');

      await b.client.post(`/api/posts/${id}/like`).expect(200);
      const removed = await a.client
        .delete(`/api/posts/${id}/like`)
        .expect(200);
      expect(removed.body as LikeState).toEqual({
        postId: id,
        liked: false,
        likeCount: 1,
      });
      await a.client.delete(`/api/posts/${id}/like`).expect(404);
      expect((await countsOf(id)).likes).toBe(1);
    });

    it('keeps one like when the same user sends many at once', async () => {
      const author = await member();
      const fan = await member();
      const id = await post(author.id);

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          fan.client.post(`/api/posts/${id}/like`),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(7);
      expect(await likes.countDocuments({ post: id })).toBe(1);
      expect((await countsOf(id)).likes).toBe(1);
    });

    it('counts exactly when many users like at once', async () => {
      const author = await member();
      const fans = await Promise.all(Array.from({ length: 6 }, () => member()));
      const id = await post(author.id);

      await Promise.all(
        fans.map((fan) => fan.client.post(`/api/posts/${id}/like`).expect(200)),
      );
      expect((await countsOf(id)).likes).toBe(6);
    });

    it('cannot like drafts, hidden or missing posts', async () => {
      const author = await member();
      const fan = await member();
      const draft = await post(author.id, { status: PostStatus.DRAFT });
      const hidden = await post(author.id, { isHidden: true });
      for (const id of [
        draft,
        hidden,
        new Types.ObjectId().toHexString(),
        'x',
      ]) {
        await fan.client.post(`/api/posts/${id}/like`).expect(404);
      }
    });

    it('removes likes together with the post', async () => {
      const author = await member();
      const fan = await member();
      const id = await post(author.id);
      await fan.client.post(`/api/posts/${id}/like`).expect(200);
      await author.client.delete(`/api/posts/${id}`).expect(204);
      expect(await likes.countDocuments({ post: id })).toBe(0);
    });
  });

  describe('Comments (BLG-05, BLG-07)', () => {
    it('adds trimmed comments to published posts and lists them oldest first', async () => {
      const author = await member();
      const a = await member(Role.USER, 'Commenter A');
      const b = await member();
      const id = await post(author.id);

      await request(ctx.server)
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'Hi' })
        .expect(401);

      const created = await a.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: '  First!  ' })
        .expect(201);
      expect(created.body as CommentView).toMatchObject({
        postId: id,
        author: { id: a.id, name: 'Commenter A' },
        body: 'First!',
        editedAt: null,
      });
      await b.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'Second' })
        .expect(201);

      const list = await request(ctx.server)
        .get(`/api/posts/${id}/comments`)
        .expect(200);
      const page = list.body as Paginated<CommentView>;
      expect(page.total).toBe(2);
      expect(page.items.map((c) => c.body)).toEqual(['First!', 'Second']);
      expect((await countsOf(id)).comments).toBe(2);
    });

    it('validates the comment text', async () => {
      const author = await member();
      const user = await member();
      const id = await post(author.id);
      for (const body of [
        {},
        { body: '' },
        { body: '   ' },
        { body: 'x'.repeat(501) },
      ]) {
        const res = await user.client
          .post(`/api/posts/${id}/comments`)
          .send(body)
          .expect(400);
        expect(fieldsOf(res)).toContain('body');
      }
      await user.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'x'.repeat(500) })
        .expect(201);
    });

    it('rejects comments on drafts or hidden posts', async () => {
      const author = await member();
      const user = await member();
      const draft = await post(author.id, { status: PostStatus.DRAFT });
      const hidden = await post(author.id, { isHidden: true });
      for (const id of [draft, hidden]) {
        await user.client
          .post(`/api/posts/${id}/comments`)
          .send({ body: 'Hello' })
          .expect(404);
        await request(ctx.server).get(`/api/posts/${id}/comments`).expect(404);
      }
    });

    it('lets only the author edit or delete a comment', async () => {
      const author = await member();
      const writer = await member();
      const other = await member();
      const id = await post(author.id);
      const created = await writer.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'Original' })
        .expect(201);
      const commentId = (created.body as CommentView).id;

      const edited = await writer.client
        .patch(`/api/comments/${commentId}`)
        .send({ body: 'Edited' })
        .expect(200);
      expect(edited.body as CommentView).toMatchObject({ body: 'Edited' });
      expect((edited.body as CommentView).editedAt).not.toBeNull();

      await other.client
        .patch(`/api/comments/${commentId}`)
        .send({ body: 'Hijack' })
        .expect(403);
      await other.client.delete(`/api/comments/${commentId}`).expect(403);
      await writer.client
        .patch(`/api/comments/${commentId}`)
        .send({ body: '' })
        .expect(400);

      await writer.client.delete(`/api/comments/${commentId}`).expect(204);
      expect((await countsOf(id)).comments).toBe(0);
      await writer.client.delete(`/api/comments/${commentId}`).expect(404);
    });

    it('shows hidden comments only to their author and admins, and keeps the count right', async () => {
      const author = await member();
      const writer = await member();
      const reader = await member();
      const admin = await member(Role.ADMIN);
      const id = await post(author.id);
      const created = await writer.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'Spam' })
        .expect(201);
      const commentId = (created.body as CommentView).id;

      await admin.client
        .delete(`/api/admin/content/comment/${commentId}`)
        .expect(200);
      await admin.client
        .delete(`/api/admin/content/comment/${commentId}`)
        .expect(200); // hiding twice is safe
      expect((await countsOf(id)).comments).toBe(0);

      const total = async (client: request.SuperTest<request.Test> | Agent) =>
        (
          (await client.get(`/api/posts/${id}/comments`).expect(200))
            .body as Paginated<CommentView>
        ).total;
      expect(await total(request(ctx.server))).toBe(0);
      expect(await total(reader.client)).toBe(0);
      expect(await total(writer.client)).toBe(1);
      expect(await total(admin.client)).toBe(1);

      // Others cannot learn it exists.
      await reader.client
        .patch(`/api/comments/${commentId}`)
        .send({ body: 'x' })
        .expect(404);
    });

    it('shows "Deleted user" for comments of deactivated accounts (ACC-12)', async () => {
      const author = await member();
      const leaver = await member(Role.USER, 'Leaving Soon');
      const id = await post(author.id);
      await leaver.client
        .post(`/api/posts/${id}/comments`)
        .send({ body: 'Bye' })
        .expect(201);
      await userModel.updateOne(
        { _id: leaver.id },
        { $set: { status: UserStatus.DEACTIVATED } },
      );

      const list = await request(ctx.server)
        .get(`/api/posts/${id}/comments`)
        .expect(200);
      expect((list.body as Paginated<CommentView>).items[0].author).toEqual({
        id: null,
        name: 'Deleted user',
      });
    });
  });
});
