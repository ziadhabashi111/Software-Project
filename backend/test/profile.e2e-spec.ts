import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { Session, SessionDocument } from '../src/auth/sessions/session.schema';
import { CURRENCY_CATALOG } from '../src/users/currency-catalog';
import { DeactivationBlockers } from '../src/users/deactivation-blockers';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

function fieldsOf(res: request.Response): string[] {
  return ((res.body as ErrorBody).errors ?? []).map((e) => e.field);
}

describe('Profile and deactivation (ACC-09, ACC-11, ACC-12; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let passwords: PasswordService;
  let userModel: Model<UserDocument>;
  let sessionModel: Model<SessionDocument>;
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    userModel = ctx.moduleRef.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    sessionModel = ctx.moduleRef.get<Model<SessionDocument>>(
      getModelToken(Session.name),
    );
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  const api = () => request(ctx.server);

  async function loggedInClient(role: Role = Role.USER) {
    counter += 1;
    const email = `profile${counter}@example.com`;
    await users.create({
      name: 'Profile User',
      email,
      passwordHash: await passwords.hash(PASSWORD),
      role,
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { email, client };
  }

  describe('GET /api/users/me', () => {
    it('needs a login', async () => {
      await api().get('/api/users/me').expect(401);
    });

    it('returns the profile without the password hash', async () => {
      const { email, client } = await loggedInClient();
      const res = await client.get('/api/users/me').expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({ email, name: 'Profile User', role: 'user' }),
      );
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });
  });

  describe('PATCH /api/users/me (ACC-09)', () => {
    it('needs a login', async () => {
      await api().patch('/api/users/me').send({ name: 'New Name' }).expect(401);
    });

    it('updates name, phone and preferred currency (currency upper-cased)', async () => {
      const { client } = await loggedInClient();
      const res = await client
        .patch('/api/users/me')
        .send({
          name: 'Ziad Habashi',
          phone: '+20 100 123 4567',
          preferredCurrency: 'egp',
        })
        .expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          name: 'Ziad Habashi',
          phone: '+20 100 123 4567',
          preferredCurrency: 'EGP',
        }),
      );
      const again = await client.get('/api/users/me').expect(200);
      expect(again.body).toEqual(
        expect.objectContaining({
          name: 'Ziad Habashi',
          preferredCurrency: 'EGP',
        }),
      );
    });

    it('can change one field and leaves the others alone', async () => {
      const { client } = await loggedInClient();
      await client
        .patch('/api/users/me')
        .send({ phone: '+201001234567', preferredCurrency: 'USD' })
        .expect(200);
      const res = await client
        .patch('/api/users/me')
        .send({ name: 'Only The Name' })
        .expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          name: 'Only The Name',
          phone: '+201001234567',
          preferredCurrency: 'USD',
        }),
      );
    });

    it('saves nothing when any field is invalid (all or nothing)', async () => {
      const { client } = await loggedInClient();
      const res = await client
        .patch('/api/users/me')
        .send({ name: 'Should Not Be Saved', phone: 'not a phone' })
        .expect(400);
      expect(fieldsOf(res)).toEqual(['phone']);
      const me = await client.get('/api/users/me').expect(200);
      expect((me.body as { name: string }).name).toBe('Profile User');
    });

    it.each([
      ['a currency that is too short', { preferredCurrency: 'EG' }],
      ['a currency that is too long', { preferredCurrency: 'EGPX' }],
      ['a numeric currency', { preferredCurrency: '123' }],
      ['an empty name', { name: '' }],
      ['a one letter name', { name: 'A' }],
      ['a null name (GEN-13)', { name: null }],
      ['a null currency (GEN-13)', { preferredCurrency: null }],
    ])('rejects %s', async (_label, patch) => {
      const { client } = await loggedInClient();
      const res = await client.patch('/api/users/me').send(patch).expect(400);
      expect(fieldsOf(res)).toEqual(Object.keys(patch));
    });

    it('clears the phone when it is sent as null', async () => {
      const { client } = await loggedInClient();
      await client
        .patch('/api/users/me')
        .send({ phone: '+201001234567' })
        .expect(200);
      const res = await client
        .patch('/api/users/me')
        .send({ phone: null })
        .expect(200);
      expect((res.body as { phone?: string }).phone ?? null).toBeNull();
      expect((res.body as { name: string }).name).toBe('Profile User');
    });

    it('rejects an empty update', async () => {
      const { client } = await loggedInClient();
      await client.patch('/api/users/me').send({}).expect(400);
    });

    it.each([
      ['email'],
      ['role'],
      ['status'],
      ['passwordHash'],
      ['mustChangePassword'],
    ])('does not let a user change their own %s', async (field) => {
      const { client } = await loggedInClient();
      await client
        .patch('/api/users/me')
        .send({ name: 'Valid Name', [field]: 'admin' })
        .expect(400);
    });
  });

  describe('DELETE /api/users/me (ACC-12)', () => {
    it('needs a login', async () => {
      await api().delete('/api/users/me?confirm=true').expect(401);
    });

    it('needs the explicit confirmation', async () => {
      const { client } = await loggedInClient();
      await client.delete('/api/users/me').expect(400);
      await client.delete('/api/users/me?confirm=false').expect(400);
      await client.get('/api/users/me').expect(200);
    });

    it('deactivates the account, signs out every device and blocks the next login', async () => {
      const { email, client } = await loggedInClient();
      const otherDevice = request.agent(ctx.server);
      await otherDevice
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });

      const res = await client.delete('/api/users/me?confirm=true').expect(204);
      const cleared = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cleared.some((c) => /^access_token=;/.test(c))).toBe(true);
      expect(cleared.some((c) => /^refresh_token=;/.test(c))).toBe(true);

      const stored = await userModel.findOne({ email });
      expect(stored?.status).toBe(UserStatus.DEACTIVATED);
      expect(
        await sessionModel.countDocuments({
          user: stored?._id,
          revokedAt: null,
        }),
      ).toBe(0);
      await client.get('/api/users/me').expect(401);
      await otherDevice.get('/api/users/me').expect(401);
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      expect((login.body as ErrorBody).message).toBe(
        'Invalid email or password',
      );
    });

    it('is blocked while the user has upcoming Confirmed bookings', async () => {
      const { email, client } = await loggedInClient();
      const me = await client.get('/api/users/me').expect(200);
      const userId = (me.body as { id: string }).id;
      ctx.moduleRef.get(DeactivationBlockers).register({
        hasUpcomingConfirmedBookings: (id) => Promise.resolve(id === userId),
      });

      const res = await client.delete('/api/users/me?confirm=true').expect(409);
      expect((res.body as ErrorBody).code).toBe('UPCOMING_BOOKINGS');
      expect((await userModel.findOne({ email }))?.status).toBe(
        UserStatus.ACTIVE,
      );
      await client.get('/api/users/me').expect(200);
    });

    it('marks the account deactivated before checking bookings, so a booking confirmed meanwhile is seen (ACC-12)', async () => {
      const { email, client } = await loggedInClient();
      const me = await client.get('/api/users/me').expect(200);
      const userId = (me.body as { id: string }).id;
      const statusesSeen: (string | undefined)[] = [];
      ctx.moduleRef.get(DeactivationBlockers).register({
        hasUpcomingConfirmedBookings: async (id) => {
          if (id !== userId) return false;
          statusesSeen.push((await userModel.findById(id).lean())?.status);
          // A payment webhook confirms a booking right now.
          return true;
        },
      });

      await client.delete('/api/users/me?confirm=true').expect(409);
      expect(statusesSeen).toEqual([UserStatus.DEACTIVATED]);
      // Refused: the account is active again and still signed in.
      expect((await userModel.findOne({ email }))?.status).toBe(
        UserStatus.ACTIVE,
      );
      await client.get('/api/users/me').expect(200);
    });

    it('ends the unpaid holds after marking the account and before checking bookings, so a late payment is refunded (ACC-12)', async () => {
      const { client } = await loggedInClient();
      const me = await client.get('/api/users/me').expect(200);
      const userId = (me.body as { id: string }).id;
      const steps: string[] = [];
      ctx.moduleRef.get(DeactivationBlockers).register({
        endPendingHolds: async (id) => {
          if (id !== userId) return;
          const status = (await userModel.findById(id).lean())?.status;
          steps.push(`end holds (${status})`);
        },
        hasUpcomingConfirmedBookings: (id) => {
          if (id === userId) steps.push('check bookings');
          return Promise.resolve(false);
        },
      });

      await client.delete('/api/users/me?confirm=true').expect(204);
      expect(steps).toEqual([
        `end holds (${UserStatus.DEACTIVATED})`,
        'check bookings',
      ]);
    });

    it('is only for regular users, not admins or moderators', async () => {
      for (const role of [
        Role.ADMIN,
        Role.HOTEL_MODERATOR,
        Role.AIRLINE_MODERATOR,
      ]) {
        const { client } = await loggedInClient(role);
        await client.delete('/api/users/me?confirm=true').expect(403);
      }
    });
  });
});

describe('Preferred currency with a supported-currency catalog (ACC-09, GEN-12)', () => {
  @Global()
  @Module({
    providers: [
      {
        provide: CURRENCY_CATALOG,
        useValue: {
          isSupported: (code: string) =>
            Promise.resolve(['EGP', 'USD'].includes(code)),
        },
      },
    ],
    exports: [CURRENCY_CATALOG],
  })
  class CatalogModule {}

  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp({ extraModules: [CatalogModule] });
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  it('accepts supported currencies and rejects the others', async () => {
    const users = ctx.moduleRef.get(UsersService);
    const passwords = ctx.moduleRef.get(PasswordService);
    await users.create({
      name: 'Currency User',
      email: 'currency@example.com',
      passwordHash: await passwords.hash(PASSWORD),
    });
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email: 'currency@example.com', password: PASSWORD })
      .expect(200);

    const bad = await client
      .patch('/api/users/me')
      .send({ preferredCurrency: 'eur' })
      .expect(400);
    expect(fieldsOf(bad)).toEqual(['preferredCurrency']);

    const ok = await client
      .patch('/api/users/me')
      .send({ preferredCurrency: 'usd' })
      .expect(200);
    expect((ok.body as { preferredCurrency: string }).preferredCurrency).toBe(
      'USD',
    );
  });
});
