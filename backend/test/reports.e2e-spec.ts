import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { BlogModerationService } from '../src/blog/blog-moderation.service';
import { BlogModule } from '../src/blog/blog.module';
import { Report } from '../src/blog/reports/report.schema';
import { Comment } from '../src/blog/schemas/comment.schema';
import { Post, PostStatus } from '../src/blog/schemas/post.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  message: string | string[];
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface ReportView {
  id: string;
  contentType: string;
  contentId: string;
  reason: string;
  status: string;
}

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

describe('Report submission (GEN-09) and blog moderation hooks (GEN-10)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let posts: Model<Post>;
  let comments: Model<Comment>;
  let reports: Model<Report>;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, BlogModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    posts = ctx.moduleRef.get(getModelToken(Post.name));
    comments = ctx.moduleRef.get(getModelToken(Comment.name));
    reports = ctx.moduleRef.get(getModelToken(Report.name));
    await reports.syncIndexes();
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedInAs(role: Role = Role.USER) {
    counter += 1;
    const email = `report${counter}@example.com`;
    const doc = await users.create({
      name: `Reporter ${counter}`,
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

  async function makePost(
    authorId: string,
    overrides: Partial<Post> = {},
  ): Promise<string> {
    const post = await posts.create({
      author: new Types.ObjectId(authorId),
      title: 'Three days in Cairo',
      body: 'Pyramids, museums and food.',
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
      ...overrides,
    });
    return post.id;
  }

  async function makeComment(
    postId: string,
    authorId: string,
    overrides: Partial<Comment> = {},
  ): Promise<string> {
    const comment = await comments.create({
      post: new Types.ObjectId(postId),
      author: new Types.ObjectId(authorId),
      body: 'Great tips!',
      ...overrides,
    });
    await posts.updateOne({ _id: postId }, { $inc: { commentCount: 1 } });
    return comment.id;
  }

  const reportBody = (contentType: string, contentId: string) => ({
    contentType,
    contentId,
    reason: 'Spam: only advertises a website',
  });

  it('requires sign-in', async () => {
    await request(ctx.server)
      .post('/api/reports')
      .send(reportBody('post', new Types.ObjectId().toHexString()))
      .expect(401);
  });

  it('reports a published post once per user', async () => {
    const author = await loggedInAs();
    const reporter = await loggedInAs();
    const other = await loggedInAs();
    const postId = await makePost(author.id);

    const res = await reporter.client
      .post('/api/reports')
      .send({ ...reportBody('post', postId), reason: '  Spam  ' })
      .expect(201);
    expect(res.body).toMatchObject({
      contentType: 'post',
      contentId: postId,
      reason: 'Spam',
      status: 'open',
    });

    const again = await reporter.client
      .post('/api/reports')
      .send(reportBody('post', postId))
      .expect(409);
    expect((again.body as ErrorBody).code).toBe('ALREADY_REPORTED');

    // Another user may report the same post.
    await other.client
      .post('/api/reports')
      .send(reportBody('post', postId))
      .expect(201);
    expect(await reports.countDocuments({ contentId: postId })).toBe(2);
  });

  it('keeps exactly one report when the same user sends it in parallel', async () => {
    const author = await loggedInAs();
    const reporter = await loggedInAs();
    const postId = await makePost(author.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        reporter.client.post('/api/reports').send(reportBody('post', postId)),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(
      await reports.countDocuments({
        contentId: postId,
        reporter: reporter.id,
      }),
    ).toBe(1);
  });

  it('rejects reporting your own content', async () => {
    const author = await loggedInAs();
    const postId = await makePost(author.id);
    await author.client
      .post('/api/reports')
      .send(reportBody('post', postId))
      .expect(400);
  });

  it('answers 404 for missing, draft or hidden posts', async () => {
    const author = await loggedInAs();
    const reporter = await loggedInAs();
    const draft = await makePost(author.id, { status: PostStatus.DRAFT });
    const hidden = await makePost(author.id, { isHidden: true });

    for (const id of [new Types.ObjectId().toHexString(), draft, hidden]) {
      await reporter.client
        .post('/api/reports')
        .send(reportBody('post', id))
        .expect(404);
    }
  });

  it('validates the type, id and reason with field errors', async () => {
    const reporter = await loggedInAs();
    const id = new Types.ObjectId().toHexString();

    const cases: [Record<string, unknown>, string][] = [
      [{ ...reportBody('video', id) }, 'contentType'],
      [{ ...reportBody('post', 'not-an-id') }, 'contentId'],
      [{ ...reportBody('post', id), reason: '   ' }, 'reason'],
      [{ ...reportBody('post', id), reason: 'x'.repeat(501) }, 'reason'],
      [{ contentType: 'post', contentId: id }, 'reason'],
    ];
    for (const [body, field] of cases) {
      const res = await reporter.client
        .post('/api/reports')
        .send(body)
        .expect(400);
      expect(fieldsOf(res)).toContain(field);
    }
  });

  it('reports a visible comment, but not one on a draft or a hidden one', async () => {
    const author = await loggedInAs();
    const commenter = await loggedInAs();
    const reporter = await loggedInAs();
    const postId = await makePost(author.id);
    const draftId = await makePost(author.id, { status: PostStatus.DRAFT });

    const ok = await makeComment(postId, commenter.id);
    const onDraft = await makeComment(draftId, commenter.id);
    const hidden = await makeComment(postId, commenter.id, { isHidden: true });

    await reporter.client
      .post('/api/reports')
      .send(reportBody('comment', ok))
      .expect(201);
    for (const id of [onDraft, hidden]) {
      await reporter.client
        .post('/api/reports')
        .send(reportBody('comment', id))
        .expect(404);
    }
  });

  it('accepts reviews and itineraries by id until their modules add a check', async () => {
    const reporter = await loggedInAs();
    for (const type of ['review', 'itinerary']) {
      await reporter.client
        .post('/api/reports')
        .send(reportBody(type, new Types.ObjectId().toHexString()))
        .expect(201);
    }
  });

  it('feeds the admin report list and hides the post when resolved with hide', async () => {
    const author = await loggedInAs();
    const reporter = await loggedInAs();
    const admin = await loggedInAs(Role.ADMIN);
    const postId = await makePost(author.id, { title: 'Report me' });

    const created = await reporter.client
      .post('/api/reports')
      .send(reportBody('post', postId))
      .expect(201);
    const reportId = (created.body as ReportView).id;

    const list = await admin.client.get('/api/admin/reports').expect(200);
    const rows = (
      list.body as { items: { id: string; reporter: { id: string } }[] }
    ).items;
    expect(rows[0]).toMatchObject({
      id: reportId,
      reporter: { id: reporter.id },
    });

    await admin.client
      .patch(`/api/admin/reports/${reportId}`)
      .send({ action: 'hide' })
      .expect(200);
    expect((await posts.findById(postId))?.isHidden).toBe(true);
    expect((await reports.findById(reportId))?.status).toBe('resolved');

    // Resolved reports leave the open list; resolving twice is a conflict.
    const after = await admin.client.get('/api/admin/reports').expect(200);
    expect(
      (after.body as { items: { id: string }[] }).items.map((r) => r.id),
    ).not.toContain(reportId);
    await admin.client
      .patch(`/api/admin/reports/${reportId}`)
      .send({ action: 'dismiss' })
      .expect(409);
  });

  it('lets an admin delete a post with its comments, and a single comment', async () => {
    const author = await loggedInAs();
    const admin = await loggedInAs(Role.ADMIN);
    const postId = await makePost(author.id);
    const keep = await makePost(author.id);
    await makeComment(postId, author.id);
    const single = await makeComment(keep, author.id);
    await makeComment(keep, author.id);

    await admin.client
      .delete(`/api/admin/content/post/${postId}?mode=delete`)
      .expect(200);
    expect(await posts.exists({ _id: postId })).toBeNull();
    expect(await comments.countDocuments({ post: postId })).toBe(0);

    await admin.client
      .delete(`/api/admin/content/comment/${single}?mode=delete`)
      .expect(200);
    expect(await comments.exists({ _id: single })).toBeNull();
    expect((await posts.findById(keep))?.commentCount).toBe(1);

    await admin.client
      .delete(`/api/admin/content/post/${new Types.ObjectId().toHexString()}`)
      .expect(404);
  });

  it('hide and unhide are safe to call twice', async () => {
    const author = await loggedInAs();
    const postId = await makePost(author.id);
    const commentId = await makeComment(postId, author.id);
    const blog = ctx.moduleRef.get(BlogModerationService);

    await blog.hidePost(postId);
    await blog.hidePost(postId);
    expect((await posts.findById(postId))?.isHidden).toBe(true);
    await blog.unhidePost(postId);
    expect((await posts.findById(postId))?.isHidden).toBe(false);

    await blog.hideComment(commentId);
    expect((await comments.findById(commentId))?.isHidden).toBe(true);
    await blog.unhideComment(commentId);
    await blog.unhideComment(commentId);
    expect((await comments.findById(commentId))?.isHidden).toBe(false);

    expect(await blog.hidePost('nope')).toBeNull();
    expect(
      await blog.deleteComment(new Types.ObjectId().toHexString()),
    ).toBeNull();
  });
  it.each([Role.HOTEL_MODERATOR, Role.AIRLINE_MODERATOR, Role.ADMIN])(
    'only registered users report content: a %s gets 403 (GEN-09)',
    async (role) => {
      const author = await loggedInAs();
      const staff = await loggedInAs(role);
      const postId = await makePost(author.id);
      await staff.client
        .post('/api/reports')
        .send(reportBody('post', postId))
        .expect(403);
    },
  );
});
