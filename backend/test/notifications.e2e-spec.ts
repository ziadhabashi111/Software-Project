import request from 'supertest';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { NotificationsService } from '../src/notifications/notifications.service';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface NotificationBody {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface PageBody {
  items: NotificationBody[];
  total: number;
  page: number;
  limit: number;
}

describe('In-app notifications (GEN-01; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let notifications: NotificationsService;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({ extraModules: [NotificationsModule] });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    notifications = ctx.moduleRef.get(NotificationsService);
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  async function loggedIn() {
    counter += 1;
    const email = `notify${counter}@example.com`;
    const user = await users.create({
      name: 'Notified User',
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.USER,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: user.id, client };
  }

  it.each([
    ['get', '/api/notifications'],
    ['get', '/api/notifications/unread-count'],
    ['patch', '/api/notifications/read-all'],
    ['patch', '/api/notifications/665f1c2a9b1e8a0012345670/read'],
  ])('%s %s needs a login', async (method, url) => {
    await request(ctx.server)[method as 'get' | 'patch'](url).expect(401);
  });

  it('lists only my notifications, newest first, 10 per page by default', async () => {
    const me = await loggedIn();
    const other = await loggedIn();
    for (let i = 1; i <= 12; i += 1) {
      await notifications.notify(me.id, 'TEST', `mine ${i}`);
    }
    await notifications.notify(other.id, 'TEST', 'not mine');

    const first = (await me.client.get('/api/notifications').expect(200))
      .body as PageBody;
    expect(first.total).toBe(12);
    expect(first.limit).toBe(10);
    expect(first.items).toHaveLength(10);
    expect(first.items[0].message).toBe('mine 12');
    expect(first.items.every((n) => n.message.startsWith('mine'))).toBe(true);

    const second = (
      await me.client.get('/api/notifications?page=2').expect(200)
    ).body as PageBody;
    expect(second.items.map((n) => n.message)).toEqual(['mine 2', 'mine 1']);

    const theirs = (await other.client.get('/api/notifications').expect(200))
      .body as PageBody;
    expect(theirs.items.map((n) => n.message)).toEqual(['not mine']);
  });

  it('returns a clean view without database internals', async () => {
    const me = await loggedIn();
    await notifications.notify(me.id, 'BOOKING', 'hello');
    const page = (await me.client.get('/api/notifications').expect(200))
      .body as PageBody;
    expect(Object.keys(page.items[0]).sort()).toEqual([
      'createdAt',
      'id',
      'message',
      'read',
      'type',
    ]);
    expect(page.items[0]).toMatchObject({
      type: 'BOOKING',
      message: 'hello',
      read: false,
    });
  });

  it('rejects a page size above the maximum', async () => {
    const me = await loggedIn();
    await me.client.get('/api/notifications?limit=101').expect(400);
  });

  it('counts and marks read only my own notifications', async () => {
    const me = await loggedIn();
    const other = await loggedIn();
    await notifications.notify(me.id, 'TEST', 'a');
    await notifications.notify(me.id, 'TEST', 'b');
    await notifications.notify(other.id, 'TEST', 'c');

    expect(
      (await me.client.get('/api/notifications/unread-count').expect(200)).body,
    ).toEqual({ count: 2 });

    const mine = (await me.client.get('/api/notifications').expect(200))
      .body as PageBody;
    const marked = (
      await me.client.patch(`/api/notifications/${mine.items[0].id}/read`)
    ).body as NotificationBody;
    expect(marked.read).toBe(true);
    expect(
      (await me.client.get('/api/notifications/unread-count')).body,
    ).toEqual({ count: 1 });

    expect(
      (await me.client.patch('/api/notifications/read-all').expect(200)).body,
    ).toEqual({ updated: 1 });
    expect(
      (await other.client.get('/api/notifications/unread-count')).body,
    ).toEqual({ count: 1 });
  });

  it("answers 404 and changes nothing for someone else's notification", async () => {
    const me = await loggedIn();
    const other = await loggedIn();
    await notifications.notify(other.id, 'TEST', 'private');
    const theirs = (await other.client.get('/api/notifications').expect(200))
      .body as PageBody;

    await me.client
      .patch(`/api/notifications/${theirs.items[0].id}/read`)
      .expect(404);
    await me.client.patch('/api/notifications/not-an-id/read').expect(404);

    const still = (await other.client.get('/api/notifications').expect(200))
      .body as PageBody;
    expect(still.items[0].read).toBe(false);
  });
});
