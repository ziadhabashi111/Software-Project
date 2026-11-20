import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import {
  ContentModerators,
  ContentType,
} from '../src/admin/content-moderators';
import type {
  ContentModerator,
  ModeratedContent,
} from '../src/admin/content-moderators';
import { ReportAction, ReportDirectory } from '../src/admin/report-source';
import type {
  AdminReportRecord,
  ReportSource,
} from '../src/admin/report-source';
import { AuditAction } from '../src/audit/audit-action';
import { AuditLog, AuditLogDocument } from '../src/audit/audit-log.schema';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

interface AuditRow {
  id: string;
  action: string;
  actor: { id: string; name?: string; email?: string };
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

interface ReportRow {
  id: string;
  contentType: string;
  contentId: string;
  reason: string;
  status: string;
  reporter: { id: string; name?: string; email?: string };
  createdAt: string;
}

function fieldsOf(res: request.Response): string[] {
  return ((res.body as ErrorBody).errors ?? []).map((e) => e.field);
}

/** An in-memory stand-in for Ahmed's Report module. */
class FakeReports implements ReportSource {
  rows: AdminReportRecord[] = [];
  resolved: { id: string; action: ReportAction; adminId: string }[] = [];
  /** Makes the next resolve() lose a race with another admin. */
  loseNextResolve = false;
  asked: { skip: number; limit: number }[] = [];

  list(query: { skip: number; limit: number }) {
    this.asked.push(query);
    const open = this.rows
      .filter((row) => row.status === 'open')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve({
      items: open.slice(query.skip, query.skip + query.limit),
      total: open.length,
    });
  }

  findById(id: string) {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  resolve(
    id: string,
    resolution: { action: ReportAction; adminId: string },
  ): Promise<boolean> {
    if (this.loseNextResolve) {
      this.loseNextResolve = false;
      return Promise.resolve(false);
    }
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'open') return Promise.resolve(false);
    row.status = 'resolved';
    this.resolved.push({ id, ...resolution });
    return Promise.resolve(true);
  }

  reopen(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = 'open';
    this.resolved = this.resolved.filter((r) => r.id !== id);
    return Promise.resolve();
  }
}

/** An in-memory stand-in for a content module (posts, comments, itineraries). */
class FakeContent implements ContentModerator {
  items = new Map<string, ModeratedContent>();
  calls: { method: 'hide' | 'delete'; id: string }[] = [];

  add(authorId?: string, title?: string): string {
    const id = new Types.ObjectId().toHexString();
    this.items.set(id, {
      ...(authorId ? { authorId } : {}),
      ...(title ? { title } : {}),
    });
    return id;
  }

  hide(id: string) {
    this.calls.push({ method: 'hide', id });
    return Promise.resolve(this.items.get(id) ?? null);
  }

  delete(id: string) {
    this.calls.push({ method: 'delete', id });
    const item = this.items.get(id) ?? null;
    this.items.delete(id);
    return Promise.resolve(item);
  }
}

describe('Admin moderation and audit logs (GEN-07, GEN-09, GEN-10; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let userModel: Model<UserDocument>;
  let auditModel: Model<AuditLogDocument>;
  let moderators: ContentModerators;
  let reportDirectory: ReportDirectory;
  let counter = 0;

  const reports = new FakeReports();
  const posts = new FakeContent();
  const comments = new FakeContent();

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule],
      replSet: true,
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    moderators = ctx.moduleRef.get(ContentModerators);
    reportDirectory = ctx.moduleRef.get(ReportDirectory);
    userModel = ctx.moduleRef.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    auditModel = ctx.moduleRef.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  const api = () => request(ctx.server);

  async function createAccount(role: Role = Role.USER, name?: string) {
    counter += 1;
    const email = `mod${counter}@example.com`;
    const doc = await users.create({
      name: name ?? `Moderation ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
    });
    return { id: doc.id, email };
  }

  async function loggedInAs(role: Role) {
    const account = await createAccount(role);
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email: account.email, password: PASSWORD })
      .expect(200);
    return { ...account, client };
  }

  function report(
    overrides: Partial<AdminReportRecord> & { reporterId: string },
  ): AdminReportRecord {
    const row: AdminReportRecord = {
      id: new Types.ObjectId().toHexString(),
      contentType: ContentType.POST,
      contentId: new Types.ObjectId().toHexString(),
      reason: 'Spam',
      status: 'open',
      createdAt: new Date(),
      ...overrides,
    };
    reports.rows.push(row);
    return row;
  }

  const someId = () => new Types.ObjectId().toHexString();

  describe('access control', () => {
    const endpoints: [string, string][] = [
      ['get', '/api/admin/audit-logs'],
      ['get', '/api/admin/reports'],
      ['patch', `/api/admin/reports/${new Types.ObjectId().toHexString()}`],
      [
        'delete',
        `/api/admin/content/post/${new Types.ObjectId().toHexString()}`,
      ],
    ];

    it.each(endpoints)('%s %s needs a login', async (method, url) => {
      await (api() as unknown as Record<string, (u: string) => request.Test>)
        [method](url)
        .expect(401);
    });

    it.each(endpoints)(
      '%s %s is forbidden for users and moderators',
      async (method, url) => {
        for (const role of [
          Role.USER,
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

  // These run before any module registers itself, so they show what an admin
  // sees while Ahmed's and Amina's modules are not connected yet.
  describe('while the other modules are not connected', () => {
    it('lists no reports instead of failing', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const res = await client.get('/api/admin/reports').expect(200);
      expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 10 });
    });

    it('cannot resolve a report: 503 REPORTS_MODULE_UNAVAILABLE', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const res = await client
        .patch(`/api/admin/reports/${someId()}`)
        .send({ action: 'dismiss' })
        .expect(503);
      expect((res.body as ErrorBody).code).toBe('REPORTS_MODULE_UNAVAILABLE');
    });

    it('cannot moderate content: 503 CONTENT_MODULE_UNAVAILABLE', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const res = await client
        .delete(`/api/admin/content/review/${someId()}`)
        .expect(503);
      expect((res.body as ErrorBody).code).toBe('CONTENT_MODULE_UNAVAILABLE');
    });
  });

  describe('GET /api/admin/audit-logs (GEN-07)', () => {
    async function seedLog(
      actorId: string,
      action: AuditAction,
      createdAt: Date,
      extra: { targetType?: string; details?: Record<string, unknown> } = {},
    ) {
      return auditModel.create({
        actor: new Types.ObjectId(actorId),
        action,
        targetType: extra.targetType ?? 'user',
        targetId: new Types.ObjectId(),
        ...(extra.details ? { details: extra.details } : {}),
        createdAt,
      });
    }

    it('lists entries newest first with the acting admin, paginated', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const actor = await createAccount(Role.ADMIN, 'Audit Actor');
      for (let day = 1; day <= 12; day++) {
        await seedLog(
          actor.id,
          AuditAction.ACCOUNT_SUSPENDED,
          new Date(Date.UTC(2026, 0, day)),
        );
      }
      const first = await client
        .get(`/api/admin/audit-logs?actorId=${actor.id}`)
        .expect(200);
      const body = first.body as Page<AuditRow>;
      expect(body.total).toBe(12);
      expect(body.limit).toBe(10);
      expect(body.items).toHaveLength(10);
      expect(body.items[0].createdAt).toBe('2026-01-12T00:00:00.000Z');
      expect(body.items[0].actor).toEqual({
        id: actor.id,
        name: 'Audit Actor',
        email: actor.email,
      });
      expect(body.items[0].action).toBe('ACCOUNT_SUSPENDED');
      expect(body.items[0].targetType).toBe('user');
      expect(body.items[0].targetId).toEqual(expect.any(String));

      const second = await client
        .get(`/api/admin/audit-logs?actorId=${actor.id}&page=2`)
        .expect(200);
      const rest = second.body as Page<AuditRow>;
      expect(rest.items.map((row) => row.createdAt)).toEqual([
        '2026-01-02T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      ]);
    });

    it('returns the details that were recorded', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const actor = await createAccount(Role.ADMIN);
      await seedLog(actor.id, AuditAction.PROVIDER_DEACTIVATED, new Date(), {
        targetType: 'hotel',
        details: { name: 'Nile Hotel' },
      });
      const res = await client
        .get(`/api/admin/audit-logs?actorId=${actor.id}`)
        .expect(200);
      const [row] = (res.body as Page<AuditRow>).items;
      expect(row.targetType).toBe('hotel');
      expect(row.details).toEqual({ name: 'Nile Hotel' });
    });

    it('filters by action and by target type', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const actor = await createAccount(Role.ADMIN);
      await seedLog(actor.id, AuditAction.ACCOUNT_SUSPENDED, new Date());
      await seedLog(actor.id, AuditAction.CONTENT_HIDDEN, new Date(), {
        targetType: 'post',
      });
      await seedLog(actor.id, AuditAction.CONTENT_DELETED, new Date(), {
        targetType: 'comment',
      });

      const byAction = await client
        .get(`/api/admin/audit-logs?actorId=${actor.id}&action=CONTENT_HIDDEN`)
        .expect(200);
      expect(
        (byAction.body as Page<AuditRow>).items.map((r) => r.action),
      ).toEqual(['CONTENT_HIDDEN']);

      const byTarget = await client
        .get(`/api/admin/audit-logs?actorId=${actor.id}&targetType=comment`)
        .expect(200);
      expect(
        (byTarget.body as Page<AuditRow>).items.map((r) => r.action),
      ).toEqual(['CONTENT_DELETED']);
    });

    it('filters by date range; a plain end date covers the whole day', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const actor = await createAccount(Role.ADMIN);
      await seedLog(
        actor.id,
        AuditAction.PASSWORD_RESET,
        new Date('2026-03-01T10:00:00Z'),
      );
      await seedLog(
        actor.id,
        AuditAction.PASSWORD_RESET,
        new Date('2026-03-05T23:30:00Z'),
      );
      await seedLog(
        actor.id,
        AuditAction.PASSWORD_RESET,
        new Date('2026-03-09T10:00:00Z'),
      );
      const res = await client
        .get(
          `/api/admin/audit-logs?actorId=${actor.id}&from=2026-03-02&to=2026-03-05`,
        )
        .expect(200);
      expect(
        (res.body as Page<AuditRow>).items.map((row) => row.createdAt),
      ).toEqual(['2026-03-05T23:30:00.000Z']);
    });

    it('rejects an unknown action, a bad actor id, bad dates and to before from', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const badAction = await client
        .get('/api/admin/audit-logs?action=EVERYTHING')
        .expect(400);
      expect(fieldsOf(badAction)).toContain('action');
      const badActor = await client
        .get('/api/admin/audit-logs?actorId=not-an-id')
        .expect(400);
      expect(fieldsOf(badActor)).toContain('actorId');
      const badDate = await client
        .get('/api/admin/audit-logs?from=yesterday')
        .expect(400);
      expect(fieldsOf(badDate)).toContain('from');
      const reversed = await client
        .get('/api/admin/audit-logs?from=2026-05-10&to=2026-05-01')
        .expect(400);
      expect(fieldsOf(reversed)).toContain('to');
      await client.get('/api/admin/audit-logs?page=0').expect(400);
    });

    it('shows the actions admins take through the API', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount(Role.USER, 'Target Traveller');
      await admin.client
        .patch(`/api/admin/accounts/${target.id}/suspend`)
        .expect(200);
      const res = await admin.client
        .get(`/api/admin/audit-logs?actorId=${admin.id}`)
        .expect(200);
      const [row] = (res.body as Page<AuditRow>).items;
      expect(row.action).toBe('ACCOUNT_SUSPENDED');
      expect(row.targetId).toBe(target.id);
    });

    it('still lists an entry whose acting admin no longer exists', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const ghost = await createAccount(Role.ADMIN);
      await seedLog(ghost.id, AuditAction.ACCOUNT_SUSPENDED, new Date());
      await userModel.deleteOne({ _id: ghost.id });
      const res = await client
        .get(`/api/admin/audit-logs?actorId=${ghost.id}`)
        .expect(200);
      const [row] = (res.body as Page<AuditRow>).items;
      expect(row.actor).toEqual({ id: ghost.id });
    });
  });

  describe('DELETE /api/admin/content/:type/:id (GEN-10)', () => {
    beforeAll(() => {
      moderators.register(ContentType.POST, posts);
      moderators.register(ContentType.COMMENT, comments);
    });

    it('hides the content by default and audits it', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const authorId = someId();
      const id = posts.add(authorId, 'Ten days in Cairo');
      const res = await admin.client
        .delete(`/api/admin/content/post/${id}`)
        .expect(200);
      expect(res.body).toEqual({ type: 'post', id, mode: 'hide' });
      expect(posts.calls.at(-1)).toEqual({ method: 'hide', id });
      expect(posts.items.has(id)).toBe(true);

      const log = await auditModel
        .findOne({ actor: admin.id, action: AuditAction.CONTENT_HIDDEN })
        .lean();
      expect(log?.targetType).toBe('post');
      expect(log?.targetId?.toString()).toBe(id);
      expect(log?.details).toEqual({ title: 'Ten days in Cairo', authorId });
    });

    it('deletes the content with mode=delete and audits it', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const id = comments.add(someId());
      const res = await admin.client
        .delete(`/api/admin/content/comment/${id}?mode=delete`)
        .expect(200);
      expect(res.body).toEqual({ type: 'comment', id, mode: 'delete' });
      expect(comments.calls.at(-1)).toEqual({ method: 'delete', id });
      expect(comments.items.has(id)).toBe(false);

      const log = await auditModel
        .findOne({ actor: admin.id, action: AuditAction.CONTENT_DELETED })
        .lean();
      expect(log?.targetType).toBe('comment');
      expect(log?.targetId?.toString()).toBe(id);
    });

    it('answers 404 and writes no audit entry for unknown content', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client
        .delete(`/api/admin/content/post/${someId()}`)
        .expect(404);
      expect(await auditModel.countDocuments({ actor: admin.id })).toBe(0);
    });

    it('rejects a bad type, a bad mode and an id that is not an ObjectId', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      await client.delete(`/api/admin/content/video/${someId()}`).expect(400);
      const badMode = await client
        .delete(`/api/admin/content/post/${someId()}?mode=burn`)
        .expect(400);
      expect(fieldsOf(badMode)).toContain('mode');
      await client.delete('/api/admin/content/post/not-an-id').expect(404);
    });
  });

  describe('GET /api/admin/reports (GEN-09, GEN-10)', () => {
    beforeAll(() => {
      reportDirectory.register(reports);
    });

    it('lists only open reports, newest first, with the reporter', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const reporter = await createAccount(Role.USER, 'Rita Reporter');
      reports.rows.length = 0;
      const older = report({
        reporterId: reporter.id,
        reason: 'Spam',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      });
      const newer = report({
        reporterId: reporter.id,
        reason: 'Abusive',
        contentType: ContentType.COMMENT,
        createdAt: new Date('2026-06-02T00:00:00Z'),
      });
      report({ reporterId: reporter.id, status: 'resolved' });

      const res = await admin.client.get('/api/admin/reports').expect(200);
      const body = res.body as Page<ReportRow>;
      expect(body.total).toBe(2);
      expect(body.items.map((row) => row.id)).toEqual([newer.id, older.id]);
      expect(body.items[0]).toMatchObject({
        contentType: 'comment',
        contentId: newer.contentId,
        reason: 'Abusive',
        status: 'open',
        reporter: {
          id: reporter.id,
          name: 'Rita Reporter',
          email: reporter.email,
        },
      });
    });

    it('asks the report module for the requested page', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client.get('/api/admin/reports?page=3&limit=5').expect(200);
      expect(reports.asked.at(-1)).toEqual({ skip: 10, limit: 5 });
    });

    it('still lists a report whose reporter no longer exists', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      reports.rows.length = 0;
      const row = report({ reporterId: someId() });
      const res = await admin.client.get('/api/admin/reports').expect(200);
      expect((res.body as Page<ReportRow>).items[0].reporter).toEqual({
        id: row.reporterId,
      });
    });
  });

  describe('PATCH /api/admin/reports/:id (GEN-10)', () => {
    beforeAll(() => {
      reportDirectory.register(reports);
      moderators.register(ContentType.POST, posts);
      moderators.register(ContentType.COMMENT, comments);
    });

    beforeEach(() => {
      reports.rows.length = 0;
      reports.resolved.length = 0;
      posts.calls.length = 0;
      comments.calls.length = 0;
    });

    it('dismisses a report without touching the content', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const contentId = posts.add(someId(), 'Fine post');
      const row = report({ reporterId: someId(), contentId });
      const res = await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'dismiss' })
        .expect(200);
      expect(res.body).toEqual({
        id: row.id,
        action: 'dismiss',
        contentType: 'post',
        contentId,
      });
      expect(reports.resolved).toEqual([
        { id: row.id, action: 'dismiss', adminId: admin.id },
      ]);
      expect(posts.calls).toHaveLength(0);

      const logs = await auditModel.find({ actor: admin.id }).lean();
      expect(logs.map((l) => l.action)).toEqual([AuditAction.REPORT_RESOLVED]);
      expect(logs[0].targetType).toBe('report');
      expect(logs[0].targetId?.toString()).toBe(row.id);
      expect(logs[0].details).toMatchObject({
        action: 'dismiss',
        contentType: 'post',
        contentId,
      });
    });

    it('hides the reported content and audits both the hide and the resolution', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const authorId = someId();
      const contentId = posts.add(authorId, 'Rude post');
      const row = report({ reporterId: someId(), contentId });
      await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'hide' })
        .expect(200);
      expect(posts.calls).toEqual([{ method: 'hide', id: contentId }]);
      expect(posts.items.has(contentId)).toBe(true);

      const logs = await auditModel
        .find({ actor: admin.id })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      expect(logs.map((l) => l.action).sort()).toEqual(
        [AuditAction.CONTENT_HIDDEN, AuditAction.REPORT_RESOLVED].sort(),
      );
      const hidden = logs.find((l) => l.action === AuditAction.CONTENT_HIDDEN);
      expect(hidden?.targetType).toBe('post');
      expect(hidden?.targetId?.toString()).toBe(contentId);
      expect(hidden?.details).toMatchObject({
        title: 'Rude post',
        authorId,
        reportId: row.id,
      });
    });

    it('deletes the reported content and audits it', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const contentId = comments.add(someId());
      const row = report({
        reporterId: someId(),
        contentType: ContentType.COMMENT,
        contentId,
      });
      await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'delete' })
        .expect(200);
      expect(comments.calls).toEqual([{ method: 'delete', id: contentId }]);
      expect(comments.items.has(contentId)).toBe(false);
      const actions = (await auditModel.find({ actor: admin.id }).lean()).map(
        (l) => l.action,
      );
      expect(actions).toContain(AuditAction.CONTENT_DELETED);
      expect(actions).toContain(AuditAction.REPORT_RESOLVED);
    });

    it('resolves the report even when the content is already gone', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const row = report({ reporterId: someId() }); // content never existed
      await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'delete' })
        .expect(200);
      expect(reports.resolved).toHaveLength(1);
      const logs = await auditModel.find({ actor: admin.id }).lean();
      expect(logs.map((l) => l.action)).toEqual([AuditAction.REPORT_RESOLVED]);
      expect(logs[0].details).toMatchObject({ contentMissing: true });
    });

    it('answers 404 for an unknown report and for an id that is not an ObjectId', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      await client
        .patch(`/api/admin/reports/${someId()}`)
        .send({ action: 'dismiss' })
        .expect(404);
      await client
        .patch('/api/admin/reports/not-an-id')
        .send({ action: 'dismiss' })
        .expect(404);
    });

    it('answers 409 for a report that is already resolved and leaves the content alone', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const contentId = posts.add(someId());
      const row = report({
        reporterId: someId(),
        contentId,
        status: 'resolved',
      });
      await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'delete' })
        .expect(409);
      expect(posts.calls).toHaveLength(0);
      expect(await auditModel.countDocuments({ actor: admin.id })).toBe(0);
    });

    it('answers 409 and writes no audit entry when another admin resolved it first', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const row = report({
        reporterId: someId(),
        contentId: posts.add(someId()),
      });
      reports.loseNextResolve = true;
      await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'dismiss' })
        .expect(409);
      expect(await auditModel.countDocuments({ actor: admin.id })).toBe(0);
    });

    it('answers 503 and keeps the report open when the content module is missing', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const row = report({
        reporterId: someId(),
        contentType: ContentType.REVIEW, // no handler registered
      });
      const res = await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'hide' })
        .expect(503);
      expect((res.body as ErrorBody).code).toBe('CONTENT_MODULE_UNAVAILABLE');
      expect(reports.resolved).toHaveLength(0);
      expect(row.status).toBe('open');
    });

    it('still dismisses a report about content whose module is missing', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const row = report({
        reporterId: someId(),
        contentType: ContentType.REVIEW,
      });
      await admin.client
        .patch(`/api/admin/reports/${row.id}`)
        .send({ action: 'dismiss' })
        .expect(200);
      expect(reports.resolved).toHaveLength(1);
    });

    it('rejects a missing or unknown action', async () => {
      const { client } = await loggedInAs(Role.ADMIN);
      const id = someId();
      const missing = await client
        .patch(`/api/admin/reports/${id}`)
        .send({})
        .expect(400);
      expect(fieldsOf(missing)).toContain('action');
      const unknown = await client
        .patch(`/api/admin/reports/${id}`)
        .send({ action: 'ban' })
        .expect(400);
      expect(fieldsOf(unknown)).toContain('action');
    });
  });
});
