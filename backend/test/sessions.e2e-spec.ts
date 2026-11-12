import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from '../src/auth/sessions/session.schema';
import { SessionService } from '../src/auth/sessions/session.service';
import { createTestApp, TestApp } from './helpers/app';

const MINUTE = 60 * 1000;

describe('SessionService (ACC-06, real MongoDB in memory)', () => {
  let ctx: TestApp;
  let sessions: SessionService;
  let model: Model<SessionDocument>;
  const userId = new Types.ObjectId().toString();

  beforeAll(async () => {
    ctx = await createTestApp();
    sessions = ctx.moduleRef.get(SessionService);
    model = ctx.moduleRef.get<Model<SessionDocument>>(
      getModelToken(Session.name),
    );
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  async function ageActivity(id: string, minutesAgo: number): Promise<void> {
    await model.updateOne(
      { _id: id },
      { lastActivityAt: new Date(Date.now() - minutesAgo * MINUTE) },
    );
  }

  it('creates a live session', async () => {
    const session = await sessions.create(userId, 'jti-1');
    expect(await sessions.validateAndTouch(session.id)).toBe(true);
  });

  it('rejects unknown and malformed session ids', async () => {
    expect(
      await sessions.validateAndTouch(new Types.ObjectId().toString()),
    ).toBe(false);
    expect(await sessions.validateAndTouch('not-an-id')).toBe(false);
  });

  it('rejects revoked sessions', async () => {
    const session = await sessions.create(userId, 'jti-1');
    await sessions.revoke(session.id);
    expect(await sessions.validateAndTouch(session.id)).toBe(false);
  });

  it('expires after 30 minutes without an authenticated request', async () => {
    const session = await sessions.create(userId, 'jti-1');
    await ageActivity(session.id, 31);
    expect(await sessions.validateAndTouch(session.id)).toBe(false);
    const stored = await model.findById(session.id);
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it('counts an authenticated request as activity (rolling session)', async () => {
    const session = await sessions.create(userId, 'jti-1');
    await ageActivity(session.id, 20);
    expect(await sessions.validateAndTouch(session.id)).toBe(true);
    const stored = await model.findById(session.id);
    expect(Date.now() - (stored?.lastActivityAt.getTime() ?? 0)).toBeLessThan(
      10_000,
    );
  });

  it('does not write on every request, only when activity is older than a minute', async () => {
    const session = await sessions.create(userId, 'jti-1');
    const recent = new Date(Date.now() - 10_000);
    await model.updateOne({ _id: session.id }, { lastActivityAt: recent });
    expect(await sessions.validateAndTouch(session.id)).toBe(true);
    const stored = await model.findById(session.id);
    expect(stored?.lastActivityAt.getTime()).toBe(recent.getTime());
  });

  it('rejects sessions past their absolute expiry', async () => {
    const session = await sessions.create(userId, 'jti-1');
    await model.updateOne(
      { _id: session.id },
      { expiresAt: new Date(Date.now() - MINUTE) },
    );
    expect(await sessions.validateAndTouch(session.id)).toBe(false);
  });

  it('rotates the refresh token once and rejects the old one', async () => {
    const session = await sessions.create(userId, 'jti-1');
    expect(await sessions.rotate(session.id, 'jti-1', 'jti-2')).toBe(true);
    expect(await sessions.rotate(session.id, 'jti-2', 'jti-3')).toBe(true);
  });

  it('revokes the whole session when an old refresh token is replayed', async () => {
    const session = await sessions.create(userId, 'jti-1');
    expect(await sessions.rotate(session.id, 'jti-1', 'jti-2')).toBe(true);
    expect(await sessions.rotate(session.id, 'jti-1', 'jti-3')).toBe(false);
    expect(await sessions.validateAndTouch(session.id)).toBe(false);
    expect(await sessions.rotate(session.id, 'jti-2', 'jti-4')).toBe(false);
  });

  it('does not rotate an idle session', async () => {
    const session = await sessions.create(userId, 'jti-1');
    await ageActivity(session.id, 31);
    expect(await sessions.rotate(session.id, 'jti-1', 'jti-2')).toBe(false);
  });

  it('revokes every session of a user, and only that user', async () => {
    const first = await sessions.create(userId, 'a');
    const second = await sessions.create(userId, 'b');
    const other = await sessions.create(new Types.ObjectId().toString(), 'c');

    await sessions.revokeAllForUser(userId);

    expect(await sessions.validateAndTouch(first.id)).toBe(false);
    expect(await sessions.validateAndTouch(second.id)).toBe(false);
    expect(await sessions.validateAndTouch(other.id)).toBe(true);
  });
});
