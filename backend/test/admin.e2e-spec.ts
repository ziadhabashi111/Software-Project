import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { ADMIN_NOTIFIER } from '../src/admin/admin-notifier';
import type { AdminNotifier } from '../src/admin/admin-notifier';
import { BookingSources } from '../src/admin/booking-sources';
import type {
  AdminBookingQuery,
  AdminBookingRecord,
} from '../src/admin/booking-sources';
import {
  ProviderDirectory,
  ProviderType,
} from '../src/admin/provider-directory';
import type { ProviderHandler } from '../src/admin/provider-directory';
import { AuditAction } from '../src/audit/audit-action';
import { AuditLog, AuditLogDocument } from '../src/audit/audit-log.schema';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { Session, SessionDocument } from '../src/auth/sessions/session.schema';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { Global, Module } from '@nestjs/common';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const TEMP_PASSWORD = 'Temp0rary1';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
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

const notifications: {
  userIds: string[];
  type: string;
  message: string;
}[] = [];

@Global()
@Module({
  providers: [
    {
      provide: ADMIN_NOTIFIER,
      useValue: {
        notify: (
          userIds: string[],
          notification: { type: string; message: string },
        ) => {
          notifications.push({ userIds, ...notification });
          return Promise.resolve();
        },
      } satisfies AdminNotifier,
    },
  ],
  exports: [ADMIN_NOTIFIER],
})
class NotifierModule {}

describe('Admin accounts, providers and bookings (ACC-07a, 13-17; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let userModel: Model<UserDocument>;
  let sessionModel: Model<SessionDocument>;
  let auditModel: Model<AuditLogDocument>;
  let directory: ProviderDirectory;
  let bookingSources: BookingSources;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp({
      extraModules: [AuditModule, AdminModule, NotifierModule],
    });
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    directory = ctx.moduleRef.get(ProviderDirectory);
    bookingSources = ctx.moduleRef.get(BookingSources);
    userModel = ctx.moduleRef.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    sessionModel = ctx.moduleRef.get<Model<SessionDocument>>(
      getModelToken(Session.name),
    );
    auditModel = ctx.moduleRef.get<Model<AuditLogDocument>>(
      getModelToken(AuditLog.name),
    );
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  const api = () => request(ctx.server);

  async function createAccount(
    options: {
      role?: Role;
      name?: string;
      status?: UserStatus;
      providerId?: string;
    } = {},
  ) {
    counter += 1;
    const email = `acct${counter}@example.com`;
    const doc = await users.create({
      name: options.name ?? `Account ${counter}`,
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role: options.role ?? Role.USER,
      status: options.status,
      providerId: options.providerId,
    });
    return { id: doc.id, email };
  }

  async function login(email: string, password = PASSWORD) {
    const client = request.agent(ctx.server);
    await client.post('/api/auth/login').send({ email, password }).expect(200);
    return client;
  }

  async function loggedInAs(role: Role) {
    const account = await createAccount({ role });
    const client = await login(account.email);
    return { ...account, client };
  }

  describe('access control', () => {
    const endpoints: [string, string][] = [
      ['get', '/api/admin/accounts'],
      ['get', '/api/admin/bookings'],
      ['post', '/api/admin/moderators'],
      [
        'post',
        `/api/admin/users/${new Types.ObjectId().toHexString()}/reset-password`,
      ],
      [
        'patch',
        `/api/admin/accounts/${new Types.ObjectId().toHexString()}/suspend`,
      ],
      [
        'patch',
        `/api/admin/accounts/${new Types.ObjectId().toHexString()}/reactivate`,
      ],
      [
        'patch',
        `/api/admin/providers/hotel/${new Types.ObjectId().toHexString()}/deactivate`,
      ],
      [
        'patch',
        `/api/admin/providers/airline/${new Types.ObjectId().toHexString()}/reactivate`,
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

  describe('GET /api/admin/accounts (ACC-14)', () => {
    it('lists accounts paginated with registration date and no password hash', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      for (let i = 0; i < 12; i += 1) await createAccount();
      const res = await admin.client.get('/api/admin/accounts').expect(200);
      const body = res.body as Page<AccountRow>;
      expect(body.page).toBe(1);
      expect(body.limit).toBe(10);
      expect(body.items).toHaveLength(10);
      expect(body.total).toBeGreaterThanOrEqual(13);
      expect(body.items[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String) as string,
          name: expect.any(String) as string,
          email: expect.any(String) as string,
          role: expect.any(String) as string,
          status: expect.any(String) as string,
          createdAt: expect.any(String) as string,
        }),
      );
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      const page2 = await admin.client
        .get('/api/admin/accounts?page=2')
        .expect(200);
      const ids = new Set(body.items.map((a) => a.id));
      expect((page2.body as Page<AccountRow>).items.length).toBeGreaterThan(0);
      for (const item of (page2.body as Page<AccountRow>).items) {
        expect(ids.has(item.id)).toBe(false);
      }
    });

    it('searches name and email case-insensitively', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount({ name: 'Zorbathustra Findme' });
      const byName = await admin.client
        .get('/api/admin/accounts?search=zorbathu')
        .expect(200);
      expect((byName.body as Page<AccountRow>).items.map((a) => a.id)).toEqual([
        target.id,
      ]);
      const byEmail = await admin.client
        .get(`/api/admin/accounts?search=${target.email.toUpperCase()}`)
        .expect(200);
      expect((byEmail.body as Page<AccountRow>).total).toBe(1);
    });

    it('treats the search text literally, not as a pattern', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .get('/api/admin/accounts?search=.*')
        .expect(200);
      expect((res.body as Page<AccountRow>).total).toBe(0);
    });

    it('filters by role and status and combines the filters', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const suspended = await createAccount({
        role: Role.HOTEL_MODERATOR,
        status: UserStatus.SUSPENDED,
        name: 'Filter Mod Suspended',
      });
      await createAccount({
        role: Role.HOTEL_MODERATOR,
        name: 'Filter Mod Active',
      });
      const res = await admin.client
        .get(
          '/api/admin/accounts?role=hotel_moderator&status=suspended&search=filter',
        )
        .expect(200);
      expect((res.body as Page<AccountRow>).items.map((a) => a.id)).toEqual([
        suspended.id,
      ]);
      const admins = await admin.client
        .get('/api/admin/accounts?role=admin')
        .expect(200);
      for (const item of (admins.body as Page<AccountRow>).items) {
        expect(item.role).toBe('admin');
      }
    });

    it.each([
      ['an unknown role', 'role=king', 'role'],
      ['an unknown status', 'status=gone', 'status'],
      ['a page of zero', 'page=0', 'page'],
    ])('rejects %s', async (_label, query, field) => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .get(`/api/admin/accounts?${query}`)
        .expect(400);
      expect(fieldsOf(res)).toEqual([field]);
    });
  });

  describe('POST /api/admin/users/:id/reset-password (ACC-07a)', () => {
    it('sets a temporary password that must be changed at the next login', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount();
      const device = await login(target.email);

      await admin.client
        .post(`/api/admin/users/${target.id}/reset-password`)
        .send({ temporaryPassword: TEMP_PASSWORD })
        .expect(204);

      await device.get('/api/users/me').expect(401);
      await api()
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(401);
      const loginRes = await api()
        .post('/api/auth/login')
        .send({ email: target.email, password: TEMP_PASSWORD })
        .expect(200);
      expect(
        (loginRes.body as { mustChangePassword: boolean }).mustChangePassword,
      ).toBe(true);
    });

    it('works for moderators and clears an account lock', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const moderator = await createAccount({ role: Role.AIRLINE_MODERATOR });
      await userModel.updateOne(
        { _id: moderator.id },
        { lockUntil: new Date(Date.now() + 600_000) },
      );
      await admin.client
        .post(`/api/admin/users/${moderator.id}/reset-password`)
        .send({ temporaryPassword: TEMP_PASSWORD })
        .expect(204);
      await api()
        .post('/api/auth/login')
        .send({ email: moderator.email, password: TEMP_PASSWORD })
        .expect(200);
    });

    it('writes an audit entry that never contains the password', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount();
      await admin.client
        .post(`/api/admin/users/${target.id}/reset-password`)
        .send({ temporaryPassword: TEMP_PASSWORD })
        .expect(204);
      const entry = await auditModel.findOne({
        action: AuditAction.PASSWORD_RESET,
        targetId: new Types.ObjectId(target.id),
      });
      expect(entry?.actor.toString()).toBe(admin.id);
      expect(entry?.targetType).toBe('user');
      expect(JSON.stringify(entry?.toObject())).not.toContain(TEMP_PASSWORD);
    });

    it('rejects a temporary password that breaks the password rules', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount();
      const res = await admin.client
        .post(`/api/admin/users/${target.id}/reset-password`)
        .send({ temporaryPassword: 'short' })
        .expect(400);
      expect(fieldsOf(res)).toEqual(['temporaryPassword']);
      await api()
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(200);
    });

    it('does not reset an administrator, even your own', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const other = await createAccount({ role: Role.ADMIN });
      for (const id of [other.id, admin.id]) {
        await admin.client
          .post(`/api/admin/users/${id}/reset-password`)
          .send({ temporaryPassword: TEMP_PASSWORD })
          .expect(403);
      }
    });

    it('answers 404 for an unknown or malformed id', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      for (const id of [new Types.ObjectId().toHexString(), 'not-an-id']) {
        await admin.client
          .post(`/api/admin/users/${id}/reset-password`)
          .send({ temporaryPassword: TEMP_PASSWORD })
          .expect(404);
      }
    });
  });

  describe('suspend and reactivate (ACC-15, ACC-16)', () => {
    it('suspends a user: signed out everywhere, cannot log in, audited', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount();
      const device = await login(target.email);

      const res = await admin.client
        .patch(`/api/admin/accounts/${target.id}/suspend`)
        .expect(200);
      expect((res.body as AccountRow).status).toBe('suspended');

      await device.get('/api/users/me').expect(401);
      expect(
        await sessionModel.countDocuments({
          user: new Types.ObjectId(target.id),
          revokedAt: null,
        }),
      ).toBe(0);
      const attempt = await api()
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(403);
      expect((attempt.body as ErrorBody).message).toBe(
        'Your account is suspended',
      );
      const entry = await auditModel.findOne({
        action: AuditAction.ACCOUNT_SUSPENDED,
        targetId: new Types.ObjectId(target.id),
      });
      expect(entry?.actor.toString()).toBe(admin.id);
    });

    it('suspends a moderator the same way', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const moderator = await createAccount({ role: Role.HOTEL_MODERATOR });
      await admin.client
        .patch(`/api/admin/accounts/${moderator.id}/suspend`)
        .expect(200);
      await api()
        .post('/api/auth/login')
        .send({ email: moderator.email, password: PASSWORD })
        .expect(403);
    });

    it('reactivates a suspended account, which can then log in, and audits it', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const target = await createAccount();
      await admin.client
        .patch(`/api/admin/accounts/${target.id}/suspend`)
        .expect(200);
      const res = await admin.client
        .patch(`/api/admin/accounts/${target.id}/reactivate`)
        .expect(200);
      expect((res.body as AccountRow).status).toBe('active');
      await api()
        .post('/api/auth/login')
        .send({ email: target.email, password: PASSWORD })
        .expect(200);
      expect(
        await auditModel.countDocuments({
          action: AuditAction.ACCOUNT_REACTIVATED,
          targetId: new Types.ObjectId(target.id),
        }),
      ).toBe(1);
    });

    it('never suspends an administrator, even yourself', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const other = await createAccount({ role: Role.ADMIN });
      for (const id of [other.id, admin.id]) {
        await admin.client
          .patch(`/api/admin/accounts/${id}/suspend`)
          .expect(403);
      }
      expect((await userModel.findById(admin.id))?.status).toBe(
        UserStatus.ACTIVE,
      );
    });

    it('answers 409 when the account is not in the right state and leaves no audit entry', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const active = await createAccount();
      await admin.client
        .patch(`/api/admin/accounts/${active.id}/reactivate`)
        .expect(409);

      await admin.client
        .patch(`/api/admin/accounts/${active.id}/suspend`)
        .expect(200);
      await admin.client
        .patch(`/api/admin/accounts/${active.id}/suspend`)
        .expect(409);
      expect(
        await auditModel.countDocuments({
          action: AuditAction.ACCOUNT_SUSPENDED,
          targetId: new Types.ObjectId(active.id),
        }),
      ).toBe(1);

      const deactivated = await createAccount({
        status: UserStatus.DEACTIVATED,
      });
      await admin.client
        .patch(`/api/admin/accounts/${deactivated.id}/suspend`)
        .expect(409);
      await admin.client
        .patch(`/api/admin/accounts/${deactivated.id}/reactivate`)
        .expect(409);
    });

    it('answers 404 for an unknown or malformed id', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      for (const id of [new Types.ObjectId().toHexString(), 'not-an-id']) {
        await admin.client
          .patch(`/api/admin/accounts/${id}/suspend`)
          .expect(404);
      }
    });
  });

  describe('POST /api/admin/moderators (ACC-13)', () => {
    const providerId = new Types.ObjectId().toHexString();

    function body(overrides: Record<string, unknown> = {}) {
      counter += 1;
      return {
        name: 'New Moderator',
        email: `moderator${counter}@example.com`,
        role: 'airline_moderator',
        providerId,
        temporaryPassword: TEMP_PASSWORD,
        ...overrides,
      };
    }

    function registerAirline(known: string[]): ProviderHandler {
      const handler: ProviderHandler = {
        exists: (id) => Promise.resolve(known.includes(id)),
        setActive: () => Promise.resolve(null),
      };
      directory.register(ProviderType.AIRLINE, handler);
      return handler;
    }

    it('says so clearly while the airline or hotel module is not available yet', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .post('/api/admin/moderators')
        .send(body({ role: 'hotel_moderator' }))
        .expect(503);
      expect((res.body as ErrorBody).code).toBe('PROVIDER_MODULE_UNAVAILABLE');
    });

    it('creates a moderator linked to one existing provider with a temporary password', async () => {
      registerAirline([providerId]);
      const admin = await loggedInAs(Role.ADMIN);
      const payload = body();
      const res = await admin.client
        .post('/api/admin/moderators')
        .send(payload)
        .expect(201);
      expect(res.body).toEqual(
        expect.objectContaining({
          name: 'New Moderator',
          email: payload.email,
          role: 'airline_moderator',
          providerId,
          status: 'active',
          mustChangePassword: true,
        }),
      );
      expect(JSON.stringify(res.body)).not.toContain(TEMP_PASSWORD);

      const loginRes = await api()
        .post('/api/auth/login')
        .send({ email: payload.email, password: TEMP_PASSWORD })
        .expect(200);
      expect(
        (loginRes.body as { mustChangePassword: boolean }).mustChangePassword,
      ).toBe(true);
      const entry = await auditModel.findOne({
        action: AuditAction.MODERATOR_CREATED,
        targetId: new Types.ObjectId((res.body as AccountRow).id),
      });
      expect(entry?.actor.toString()).toBe(admin.id);
      expect(JSON.stringify(entry?.toObject())).not.toContain(TEMP_PASSWORD);
    });

    it('rejects a provider that does not exist', async () => {
      registerAirline([providerId]);
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .post('/api/admin/moderators')
        .send(body({ providerId: new Types.ObjectId().toHexString() }))
        .expect(400);
      expect(fieldsOf(res)).toEqual(['providerId']);
    });

    it.each([
      ['an admin role', { role: 'admin' }, 'role'],
      ['a user role', { role: 'user' }, 'role'],
      ['a malformed provider id', { providerId: 'abc' }, 'providerId'],
      [
        'a weak temporary password',
        { temporaryPassword: 'weak' },
        'temporaryPassword',
      ],
      ['an invalid email', { email: 'nope' }, 'email'],
      ['a one letter name', { name: 'A' }, 'name'],
    ])('rejects %s', async (_label, overrides, field) => {
      registerAirline([providerId]);
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .post('/api/admin/moderators')
        .send(body(overrides))
        .expect(400);
      expect(fieldsOf(res)).toEqual([field]);
    });

    it('answers 409 when the email is already registered', async () => {
      registerAirline([providerId]);
      const admin = await loggedInAs(Role.ADMIN);
      const existing = await createAccount();
      const res = await admin.client
        .post('/api/admin/moderators')
        .send(body({ email: existing.email.toUpperCase() }))
        .expect(409);
      expect(fieldsOf(res)).toEqual(['email']);
    });
  });

  describe('provider deactivation (ACC-15)', () => {
    const hotelId = new Types.ObjectId().toHexString();
    let active = true;
    let setActiveCalls: boolean[] = [];

    beforeAll(() => {
      directory.register(ProviderType.HOTEL, {
        exists: (id) => Promise.resolve(id === hotelId),
        setActive: (id, value) => {
          if (id !== hotelId) return Promise.resolve(null);
          const changed = active !== value;
          active = value;
          setActiveCalls.push(value);
          return Promise.resolve({
            name: 'Nile Hotel',
            changed,
            affectedUserIds: ['traveller-1'],
          });
        },
      });
    });

    beforeEach(() => {
      active = true;
      setActiveCalls = [];
      notifications.length = 0;
    });

    it('deactivates the hotel, audits it and notifies its moderators and affected travellers', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const moderator = await createAccount({
        role: Role.HOTEL_MODERATOR,
        providerId: hotelId,
      });
      const res = await admin.client
        .patch(`/api/admin/providers/hotel/${hotelId}/deactivate`)
        .expect(200);
      expect(res.body).toEqual({
        id: hotelId,
        type: 'hotel',
        name: 'Nile Hotel',
        active: false,
        changed: true,
      });
      expect(setActiveCalls).toEqual([false]);
      const entry = await auditModel.findOne({
        action: AuditAction.PROVIDER_DEACTIVATED,
        targetId: new Types.ObjectId(hotelId),
      });
      expect(entry?.actor.toString()).toBe(admin.id);
      expect(entry?.targetType).toBe('hotel');

      expect(notifications).toHaveLength(1);
      expect(notifications[0].userIds.sort()).toEqual(
        [moderator.id, 'traveller-1'].sort(),
      );
      expect(notifications[0].message).toContain('Nile Hotel');
    });

    it('reactivates it and records PROVIDER_REACTIVATED', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      active = false;
      const res = await admin.client
        .patch(`/api/admin/providers/hotel/${hotelId}/reactivate`)
        .expect(200);
      expect((res.body as { active: boolean }).active).toBe(true);
      expect(
        await auditModel.countDocuments({
          action: AuditAction.PROVIDER_REACTIVATED,
          targetId: new Types.ObjectId(hotelId),
        }),
      ).toBe(1);
      expect(notifications).toHaveLength(1);
    });

    it('is a no-op, without audit entry or notification, when nothing changes', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const before = await auditModel.countDocuments({
        action: AuditAction.PROVIDER_REACTIVATED,
      });
      const res = await admin.client
        .patch(`/api/admin/providers/hotel/${hotelId}/reactivate`)
        .expect(200);
      expect((res.body as { changed: boolean }).changed).toBe(false);
      expect(
        await auditModel.countDocuments({
          action: AuditAction.PROVIDER_REACTIVATED,
        }),
      ).toBe(before);
      expect(notifications).toHaveLength(0);
    });

    it('answers 404 for an unknown provider, 400 for an unknown type', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      await admin.client
        .patch(
          `/api/admin/providers/hotel/${new Types.ObjectId().toHexString()}/deactivate`,
        )
        .expect(404);
      await admin.client
        .patch(`/api/admin/providers/hotel/not-an-id/deactivate`)
        .expect(404);
      await admin.client
        .patch(`/api/admin/providers/spaceship/${hotelId}/deactivate`)
        .expect(400);
    });
  });

  describe('GET /api/admin/bookings (ACC-17)', () => {
    function record(
      type: 'flight' | 'hotel',
      n: number,
      userId: string,
      overrides: Partial<AdminBookingRecord> = {},
    ): AdminBookingRecord {
      return {
        id: `${type}-${n}`,
        reference: `${type.toUpperCase()}-${n}`,
        type,
        userId,
        provider: { id: `p-${type}`, name: `${type} provider` },
        startDate: new Date(Date.UTC(2027, 0, n)),
        endDate: new Date(Date.UTC(2027, 0, n + 2)),
        amount: 100 * n,
        currency: 'EGP',
        status: 'Confirmed',
        createdAt: new Date(Date.UTC(2026, 10, n)),
        ...overrides,
      };
    }

    const queries: Record<string, AdminBookingQuery[]> = {
      flight: [],
      hotel: [],
    };
    let traveller: { id: string; email: string };
    let flights: AdminBookingRecord[];
    let hotels: AdminBookingRecord[];

    beforeAll(async () => {
      traveller = await createAccount({ name: 'Booking Traveller' });
      flights = [1, 3, 5].map((n) => record('flight', n, traveller.id));
      hotels = [2, 4].map((n) =>
        record('hotel', n, traveller.id, { status: 'Cancelled' }),
      );
      for (const [type, rows] of [
        ['flight', flights],
        ['hotel', hotels],
      ] as const) {
        bookingSources.register({
          type,
          find: (query) => {
            queries[type].push(query);
            const items = rows
              .filter((r) => !query.status || r.status === query.status)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return Promise.resolve({
              items: items.slice(query.skip, query.skip + query.limit),
              total: items.length,
            });
          },
        });
      }
    });

    beforeEach(() => {
      queries.flight = [];
      queries.hotel = [];
    });

    it('merges flight and hotel bookings, newest first, with user names and the total', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client.get('/api/admin/bookings').expect(200);
      const body = res.body as Page<Record<string, unknown>>;
      expect(body.total).toBe(5);
      expect(body.items.map((b) => b.reference)).toEqual([
        'FLIGHT-5',
        'HOTEL-4',
        'FLIGHT-3',
        'HOTEL-2',
        'FLIGHT-1',
      ]);
      expect(body.items[0]).toEqual(
        expect.objectContaining({
          type: 'flight',
          provider: { id: 'p-flight', name: 'flight provider' },
          amount: 500,
          currency: 'EGP',
          status: 'Confirmed',
          user: {
            id: traveller.id,
            name: 'Booking Traveller',
            email: traveller.email,
          },
        }),
      );
    });

    it('paginates across both sources', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .get('/api/admin/bookings?page=2&limit=2')
        .expect(200);
      const body = res.body as Page<Record<string, unknown>>;
      expect(body.total).toBe(5);
      expect(body.items.map((b) => b.reference)).toEqual([
        'FLIGHT-3',
        'HOTEL-2',
      ]);
    });

    it('filters by type and only asks the matching source', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .get('/api/admin/bookings?type=hotel')
        .expect(200);
      expect((res.body as Page<unknown>).total).toBe(2);
      expect(queries.flight).toHaveLength(0);
      expect(queries.hotel).toHaveLength(1);
    });

    it('passes the status and the date range to the sources', async () => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .get(
          '/api/admin/bookings?status=Cancelled&from=2027-01-01&to=2027-01-31',
        )
        .expect(200);
      expect((res.body as Page<unknown>).total).toBe(2);
      const asked = queries.hotel[0];
      expect(asked.status).toBe('Cancelled');
      expect(asked.from?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
      expect(asked.to?.toISOString()).toBe('2027-01-31T23:59:59.999Z');
    });

    it.each([
      ['an unknown type', 'type=train', 'type'],
      ['a malformed date', 'from=yesterday', 'from'],
      ['an end before the start', 'from=2027-02-01&to=2027-01-01', 'to'],
    ])('rejects %s', async (_label, query, field) => {
      const admin = await loggedInAs(Role.ADMIN);
      const res = await admin.client
        .get(`/api/admin/bookings?${query}`)
        .expect(400);
      expect(fieldsOf(res)).toEqual([field]);
    });
  });
});

describe('Admin bookings before any booking module exists (ACC-17)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({ extraModules: [AuditModule, AdminModule] });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('returns an empty page instead of failing', async () => {
    const users = ctx.moduleRef.get(UsersService);
    const passwords = ctx.moduleRef.get(PasswordService);
    await users.create({
      name: 'Lonely Admin',
      email: 'lonely@example.com',
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.ADMIN,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email: 'lonely@example.com', password: PASSWORD })
      .expect(200);
    const res = await client.get('/api/admin/bookings').expect(200);
    expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 10 });
  });
});
