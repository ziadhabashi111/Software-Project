import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import { Session, SessionDocument } from '../src/auth/sessions/session.schema';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';
const MINUTE = 60 * 1000;

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header ?? [];
}

/** "name=value" pair of a cookie set by the response. */
function cookiePair(res: request.Response, name: string): string | undefined {
  return setCookies(res)
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0];
}

describe('Auth API (ACC-01, 04, 05, 06, 08, 19; real MongoDB in memory)', () => {
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
  const agent = () => request.agent(ctx.server);

  function nextEmail(): string {
    counter += 1;
    return `user${counter}@example.com`;
  }

  async function registerUser(email = nextEmail()): Promise<string> {
    await api()
      .post('/api/auth/register')
      .send({ name: 'Test User', email, password: PASSWORD, consent: true })
      .expect(201);
    return email;
  }

  async function createUser(
    overrides: Partial<{
      status: UserStatus;
      mustChangePassword: boolean;
      role: Role;
    }> = {},
  ): Promise<string> {
    const email = nextEmail();
    await users.create({
      name: 'Created User',
      email,
      passwordHash: await passwords.hash(PASSWORD),
      ...overrides,
    });
    return email;
  }

  describe('POST /api/auth/register (ACC-01)', () => {
    it('creates a regular user and never returns the password hash', async () => {
      const res = await api()
        .post('/api/auth/register')
        .send({
          name: 'Ziad Habashi',
          email: 'Ziad.New@Example.com',
          password: PASSWORD,
          consent: true,
        })
        .expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          name: 'Ziad Habashi',
          email: 'ziad.new@example.com',
          role: 'user',
        }),
      );
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    });

    it('stores only a salted hash of the password', async () => {
      const email = await registerUser();
      const stored = await userModel.findOne({ email }).select('+passwordHash');
      expect(stored?.passwordHash).toBeDefined();
      expect(stored?.passwordHash).not.toContain(PASSWORD);
      expect(stored?.consentAcceptedAt).toBeInstanceOf(Date);
    });

    it('rejects a duplicate email with an inline error (case-insensitive)', async () => {
      const email = await registerUser();
      const res = await api()
        .post('/api/auth/register')
        .send({
          name: 'Other',
          email: email.toUpperCase(),
          password: PASSWORD,
          consent: true,
        })
        .expect(409);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'email', messages: ['Email is already registered'] },
      ]);
    });

    it.each([
      ['an invalid email', { email: 'nope' }, 'email'],
      ['a password without a digit', { password: 'abcdefghij' }, 'password'],
      ['a password without a letter', { password: '1234567890' }, 'password'],
      ['a password shorter than 8', { password: 'Ab1' }, 'password'],
      ['missing consent', { consent: false }, 'consent'],
      ['an empty name', { name: '' }, 'name'],
    ])('rejects %s with a field-level error', async (_label, patch, field) => {
      const res = await api()
        .post('/api/auth/register')
        .send({
          name: 'Test User',
          email: nextEmail(),
          password: PASSWORD,
          consent: true,
          ...patch,
        })
        .expect(400);
      const fields = ((res.body as ErrorBody).errors ?? []).map((e) => e.field);
      expect(fields).toContain(field);
    });

    it('does not let a client choose its own role', async () => {
      await api()
        .post('/api/auth/register')
        .send({
          name: 'Sneaky',
          email: nextEmail(),
          password: PASSWORD,
          consent: true,
          role: 'admin',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/login (ACC-04, ACC-19)', () => {
    it('logs in and sets httpOnly access and refresh cookies, not in the body', async () => {
      const email = await registerUser();
      const res = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      const cookies = setCookies(res);
      for (const name of ['access_token', 'refresh_token']) {
        const cookie = cookies.find((c) => c.startsWith(`${name}=`));
        expect(cookie).toBeDefined();
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
      }
      expect(res.body).toEqual(
        expect.objectContaining({
          user: expect.objectContaining({ email, role: 'user' }) as unknown,
          mustChangePassword: false,
        }),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);
    });

    it('logs in with a differently cased email', async () => {
      const email = await registerUser();
      await api()
        .post('/api/auth/login')
        .send({ email: email.toUpperCase(), password: PASSWORD })
        .expect(200);
    });

    it('gives the same generic message for a wrong password and an unknown email', async () => {
      const email = await registerUser();
      const wrong = await api()
        .post('/api/auth/login')
        .send({ email, password: 'Wrong1234' })
        .expect(401);
      const unknown = await api()
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: PASSWORD })
        .expect(401);
      expect((wrong.body as ErrorBody).message).toBe(
        'Invalid email or password',
      );
      expect((unknown.body as ErrorBody).message).toBe(
        'Invalid email or password',
      );
    });

    it('shows "account suspended" for a suspended account with the right password', async () => {
      const email = await createUser({ status: UserStatus.SUSPENDED });
      const res = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(403);
      expect((res.body as ErrorBody).message).toBe('Your account is suspended');
    });

    it('does not reveal a suspension to someone with the wrong password', async () => {
      const email = await createUser({ status: UserStatus.SUSPENDED });
      const res = await api()
        .post('/api/auth/login')
        .send({ email, password: 'Wrong1234' })
        .expect(401);
      expect((res.body as ErrorBody).message).toBe('Invalid email or password');
    });

    it('does not let a deactivated user log in', async () => {
      const email = await createUser({ status: UserStatus.DEACTIVATED });
      await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
    });
  });

  describe('Lockout after failed logins (ACC-05)', () => {
    const wrong = (email: string) =>
      api().post('/api/auth/login').send({ email, password: 'Wrong1234' });

    it('locks the account for 15 minutes on the 5th consecutive failure', async () => {
      const email = await registerUser();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await wrong(email).expect(401);
      }
      const fifth = await wrong(email).expect(429);
      expect((fifth.body as ErrorBody).message).toMatch(/locked.*15 minutes/i);

      const correct = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(429);
      expect((correct.body as ErrorBody).message).toMatch(/locked/i);
    });

    it('lets the user back in once the lock has passed', async () => {
      const email = await registerUser();
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await wrong(email);
      }
      await userModel.updateOne(
        { email },
        { lockUntil: new Date(Date.now() - MINUTE) },
      );
      await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
    });

    it('resets the counter after a successful login', async () => {
      const email = await registerUser();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await wrong(email).expect(401);
      }
      await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await wrong(email).expect(401);
      }
    });
  });

  describe('GET /api/auth/me (ACC-19)', () => {
    it('needs a login', async () => {
      await api().get('/api/auth/me').expect(401);
    });

    it('returns the current user from the cookie', async () => {
      const email = await registerUser();
      const client = agent();
      await client.post('/api/auth/login').send({ email, password: PASSWORD });
      const res = await client.get('/api/auth/me').expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          email,
          role: 'user',
          status: 'active',
          mustChangePassword: false,
        }),
      );
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('protects other routes by default and opens them after login', async () => {
      const email = await registerUser();
      await api().get('/api/probe/secured').expect(401);
      const client = agent();
      await client.post('/api/auth/login').send({ email, password: PASSWORD });
      await client.get('/api/probe/secured').expect(200);
    });
  });

  describe('POST /api/auth/refresh (refresh and access tokens)', () => {
    it('issues new tokens and rotates the refresh token', async () => {
      const email = await registerUser();
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      const oldRefresh = cookiePair(login, 'refresh_token') as string;

      const refreshed = await api()
        .post('/api/auth/refresh')
        .set('Cookie', oldRefresh)
        .expect(204);

      const newRefresh = cookiePair(refreshed, 'refresh_token');
      expect(newRefresh).toBeDefined();
      expect(newRefresh).not.toBe(oldRefresh);
      expect(cookiePair(refreshed, 'access_token')).toBeDefined();
    });

    it('works without an access token (it expired) as long as the session is alive', async () => {
      const email = await registerUser();
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      const refresh = cookiePair(login, 'refresh_token') as string;
      await api().post('/api/auth/refresh').set('Cookie', refresh).expect(204);
    });

    it('rejects a missing or invalid refresh token', async () => {
      await api().post('/api/auth/refresh').expect(401);
      await api()
        .post('/api/auth/refresh')
        .set('Cookie', 'refresh_token=garbage')
        .expect(401);
    });

    it('does not accept an access token as a refresh token', async () => {
      const email = await registerUser();
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      const access = (cookiePair(login, 'access_token') as string).replace(
        'access_token=',
        'refresh_token=',
      );
      await api().post('/api/auth/refresh').set('Cookie', access).expect(401);
    });

    it('kills the session when an old refresh token is replayed (theft)', async () => {
      const email = await registerUser();
      const client = agent();
      const login = await client
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      const oldRefresh = cookiePair(login, 'refresh_token') as string;

      await client.post('/api/auth/refresh').expect(204);
      // The thief replays it later than the two-tab grace window.
      await sessionModel.updateMany(
        {},
        { rotatedAt: new Date(Date.now() - 60_000) },
      );
      await api()
        .post('/api/auth/refresh')
        .set('Cookie', oldRefresh)
        .expect(401);
      await client.get('/api/auth/me').expect(401);
    });

    it('keeps the session when two tabs refresh with the same token at once', async () => {
      const email = await registerUser();
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      const shared = cookiePair(login, 'refresh_token') as string;

      const [first, second] = await Promise.all([
        api().post('/api/auth/refresh').set('Cookie', shared),
        api().post('/api/auth/refresh').set('Cookie', shared),
      ]);
      expect([first.status, second.status]).toEqual([204, 204]);

      // Whichever answer the browser keeps, it can refresh again.
      for (const res of [first, second]) {
        const access = cookiePair(res, 'access_token') as string;
        await api().get('/api/auth/me').set('Cookie', access).expect(200);
      }
      await api()
        .post('/api/auth/refresh')
        .set('Cookie', cookiePair(second, 'refresh_token') as string)
        .expect(204);
    });

    it('refuses to refresh a suspended account', async () => {
      const email = await registerUser();
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      await userModel.updateOne({ email }, { status: UserStatus.SUSPENDED });
      await api()
        .post('/api/auth/refresh')
        .set('Cookie', cookiePair(login, 'refresh_token') as string)
        .expect(401);
    });
  });

  describe('POST /api/auth/logout (ACC-06)', () => {
    it('clears the cookies and revokes the session on the server', async () => {
      const email = await registerUser();
      const login = await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD });
      const access = cookiePair(login, 'access_token') as string;
      const refresh = cookiePair(login, 'refresh_token') as string;

      const out = await api()
        .post('/api/auth/logout')
        .set('Cookie', `${access}; ${refresh}`)
        .expect(204);
      const cleared = setCookies(out);
      expect(cleared.some((c) => /^access_token=;/.test(c))).toBe(true);
      expect(cleared.some((c) => /^refresh_token=;/.test(c))).toBe(true);

      await api().get('/api/auth/me').set('Cookie', access).expect(401);
      await api().post('/api/auth/refresh').set('Cookie', refresh).expect(401);
    });

    it('is harmless when nobody is logged in', async () => {
      await api().post('/api/auth/logout').expect(204);
    });
  });

  describe('Session expiry (ACC-06)', () => {
    it('expires a session after 30 minutes without an authenticated request', async () => {
      const email = await registerUser();
      const client = agent();
      await client.post('/api/auth/login').send({ email, password: PASSWORD });
      await client.get('/api/auth/me').expect(200);

      await sessionModel.updateMany(
        {},
        { lastActivityAt: new Date(Date.now() - 31 * MINUTE) },
      );
      await client.get('/api/auth/me').expect(401);
    });

    it('keeps a session alive while the user keeps making requests', async () => {
      const email = await registerUser();
      const client = agent();
      await client.post('/api/auth/login').send({ email, password: PASSWORD });

      await sessionModel.updateMany(
        {},
        { lastActivityAt: new Date(Date.now() - 20 * MINUTE) },
      );
      await client.get('/api/auth/me').expect(200);
      await sessionModel.updateMany(
        {},
        { lastActivityAt: new Date(Date.now() - 20 * MINUTE) },
      );
      await client.get('/api/auth/me').expect(200);
    });
  });

  describe('PATCH /api/auth/change-password (ACC-08)', () => {
    const NEW_PASSWORD = 'NewPassw0rd';

    async function loggedIn(): Promise<{
      email: string;
      client: ReturnType<typeof agent>;
    }> {
      const email = await registerUser();
      const client = agent();
      await client.post('/api/auth/login').send({ email, password: PASSWORD });
      return { email, client };
    }

    it('needs a login', async () => {
      await api()
        .patch('/api/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('rejects a wrong current password', async () => {
      const { client } = await loggedIn();
      const res = await client
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'Wrong1234', newPassword: NEW_PASSWORD })
        .expect(400);
      expect(((res.body as ErrorBody).errors ?? [])[0]?.field).toBe(
        'currentPassword',
      );
    });

    it('rejects a new password that breaks the rules or repeats the old one', async () => {
      const { client } = await loggedIn();
      const weak = await client
        .patch('/api/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);
      expect(
        ((weak.body as ErrorBody).errors ?? []).map((e) => e.field),
      ).toContain('newPassword');
      const same = await client
        .patch('/api/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
        .expect(400);
      expect(((same.body as ErrorBody).errors ?? [])[0]?.field).toBe(
        'newPassword',
      );
    });

    it('changes the password, keeps this device logged in and signs out the others', async () => {
      const { email, client } = await loggedIn();
      const other = agent();
      await other.post('/api/auth/login').send({ email, password: PASSWORD });

      await client
        .patch('/api/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);

      await client.get('/api/auth/me').expect(200);
      await other.get('/api/auth/me').expect(401);

      await api()
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
      await api()
        .post('/api/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(200);
    });
  });

  describe('Temporary passwords (ACC-07a, ACC-13)', () => {
    it('lets the user in but blocks everything until the password is changed', async () => {
      const email = await createUser({ mustChangePassword: true });
      const client = agent();
      const login = await client
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      expect(
        (login.body as { mustChangePassword: boolean }).mustChangePassword,
      ).toBe(true);

      const blocked = await client.get('/api/probe/secured').expect(403);
      expect((blocked.body as ErrorBody).code).toBe('PASSWORD_CHANGE_REQUIRED');
      await client.get('/api/auth/me').expect(200);

      await client
        .patch('/api/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: 'FreshPassw0rd' })
        .expect(204);

      await client.get('/api/probe/secured').expect(200);
      const me = await client.get('/api/auth/me').expect(200);
      expect(
        (me.body as { mustChangePassword: boolean }).mustChangePassword,
      ).toBe(false);
    });
  });
});
