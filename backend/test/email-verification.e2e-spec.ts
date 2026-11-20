import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { AdminModule } from '../src/admin/admin.module';
import { AuditModule } from '../src/audit/audit.module';
import { Role } from '../src/auth/auth.types';
import { PasswordService } from '../src/auth/password.service';
import {
  EmailToken,
  EmailTokenDocument,
  EmailTokenPurpose,
} from '../src/auth/email-tokens/email-token.schema';
import { HotelsModule } from '../src/hotels/hotels.module';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const PASSWORD = 'Passw0rdOk';

interface ErrorBody {
  code?: string;
  errors?: { field: string; messages: string[] }[];
}

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

describe('Email verification (ACC-02; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let userModel: Model<UserDocument>;
  let tokenModel: Model<EmailTokenDocument>;
  let sent: MailMessage[];
  let sendMock: jest.SpyInstance;
  let counter = 0;
  const previousFlag = process.env.EMAIL_VERIFICATION_REQUIRED;

  beforeAll(async () => {
    ctx = await createTestApp({
      replSet: true,
      extraModules: [AuditModule, AdminModule, HotelsModule],
    });
    users = ctx.moduleRef.get(UsersService);
    userModel = ctx.moduleRef.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
    tokenModel = ctx.moduleRef.get<Model<EmailTokenDocument>>(
      getModelToken(EmailToken.name),
    );
    sendMock = jest
      .spyOn(ctx.moduleRef.get(MailService), 'send')
      .mockImplementation((message) => {
        sent.push(message);
        return Promise.resolve();
      });
  }, 180_000);

  beforeEach(() => {
    sent = [];
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
  });

  afterAll(async () => {
    if (previousFlag === undefined)
      delete process.env.EMAIL_VERIFICATION_REQUIRED;
    else process.env.EMAIL_VERIFICATION_REQUIRED = previousFlag;
    jest.restoreAllMocks();
    await ctx.close();
  });

  const api = () => request(ctx.server);

  async function register(): Promise<{ id: string; email: string }> {
    counter += 1;
    const email = `verify${counter}@example.com`;
    const res = await api()
      .post('/api/auth/register')
      .send({ name: 'Verify Person', email, password: PASSWORD, consent: true })
      .expect(201);
    return { id: (res.body as { id: string }).id, email };
  }

  /** The email is sent in the background, so wait until it has been captured. */
  async function untilSent(count: number): Promise<void> {
    for (let i = 0; i < 100 && sent.length < count; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(sent.length).toBeGreaterThanOrEqual(count);
  }

  const tokenOf = (message: MailMessage): string =>
    /token=([A-Za-z0-9_-]+)/.exec(message.text)![1];

  async function loggedIn(email: string) {
    const client = request.agent(ctx.server);
    await client
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return client;
  }

  const verify = (token: string) =>
    api().get('/api/auth/verify-email').query({ token });

  describe('registration', () => {
    it('starts unverified and emails a 24-hour link', async () => {
      const { email } = await register();
      await untilSent(1);
      expect(sent[0].to).toBe(email);
      expect(sent[0].text).toContain('/verify-email?token=');
      expect(sent[0].text).toContain('24 hours');

      const me = await (await loggedIn(email)).get('/api/auth/me').expect(200);
      expect((me.body as { emailVerified: boolean }).emailVerified).toBe(false);
    });

    // A broken mail server must not stop people signing up.
    it('still succeeds when the email cannot be sent', async () => {
      sendMock.mockRejectedValueOnce(new Error('connection refused'));
      const { email } = await register();
      await loggedIn(email); // the account works
    });

    it('counts accounts that were not self-registered as verified', async () => {
      const passwords = ctx.moduleRef.get(PasswordService);
      await users.create({
        name: 'Seeded',
        email: 'seeded-verify@example.com',
        passwordHash: await passwords.hash(PASSWORD),
        role: Role.USER,
      });
      const me = await (
        await loggedIn('seeded-verify@example.com')
      )
        .get('/api/auth/me')
        .expect(200);
      expect((me.body as { emailVerified: boolean }).emailVerified).toBe(true);
    });
  });

  describe('GET /api/auth/verify-email', () => {
    it('verifies the account with the emailed link', async () => {
      const { id, email } = await register();
      await untilSent(1);
      const res = await verify(tokenOf(sent[0])).expect(200);
      expect((res.body as { message: string }).message).toContain('verified');

      const me = await (await loggedIn(email)).get('/api/auth/me').expect(200);
      expect((me.body as { emailVerified: boolean }).emailVerified).toBe(true);
      const stored = await userModel.findById(id);
      expect(stored?.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('works once: the same link again answers 400', async () => {
      await register();
      await untilSent(1);
      const token = tokenOf(sent[0]);
      await verify(token).expect(200);
      const again = await verify(token).expect(400);
      expect(fieldsOf(again)).toContain('token');
    });

    it('rejects an expired link', async () => {
      const { id } = await register();
      await untilSent(1);
      await tokenModel.updateOne(
        { user: id, purpose: EmailTokenPurpose.EMAIL_VERIFICATION },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      const res = await verify(tokenOf(sent[0])).expect(400);
      expect(fieldsOf(res)).toContain('token');
    });

    it('rejects an unknown token and a missing token', async () => {
      await verify('this-token-never-existed').expect(400);
      const missing = await api().get('/api/auth/verify-email').expect(400);
      expect(fieldsOf(missing)).toContain('token');
    });

    // A password-reset link must not verify an email, and the other way round.
    it('does not accept a password reset token', async () => {
      const { email } = await register();
      await untilSent(1);
      await api().post('/api/auth/forgot-password').send({ email }).expect(200);
      await untilSent(2);
      const resetToken = tokenOf(sent[1]);
      await verify(resetToken).expect(400);
    });
  });

  describe('POST /api/auth/resend-verification', () => {
    it('needs a login', async () => {
      await api().post('/api/auth/resend-verification').expect(401);
    });

    it('sends a new link that replaces the old one', async () => {
      const { email } = await register();
      await untilSent(1);
      const oldToken = tokenOf(sent[0]);

      const client = await loggedIn(email);
      const res = await client
        .post('/api/auth/resend-verification')
        .expect(200);
      expect((res.body as { message: string }).message).toContain('new');
      await untilSent(2);
      const newToken = tokenOf(sent[1]);
      expect(newToken).not.toBe(oldToken);

      await verify(oldToken).expect(400);
      await verify(newToken).expect(200);
    });

    it('sends nothing to someone who is already verified', async () => {
      const { email } = await register();
      await untilSent(1);
      await verify(tokenOf(sent[0])).expect(200);

      const client = await loggedIn(email);
      const res = await client
        .post('/api/auth/resend-verification')
        .expect(200);
      expect((res.body as { message: string }).message).toContain('already');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(sent).toHaveLength(1);
    });
  });

  // The switch: with it off (the default) nobody is blocked; with it on, a
  // route that creates a booking refuses an unverified user. The hotel booking
  // route is used because it is a real one; a verified user passes the guard
  // and then fails on the empty body (400), which proves the guard let them in.
  describe('booking block (EMAIL_VERIFICATION_REQUIRED)', () => {
    const book = (client: ReturnType<typeof request.agent>) =>
      client.post('/api/hotel-bookings').send({});

    it('does not block anyone by default', async () => {
      const { email } = await register();
      const res = await book(await loggedIn(email));
      expect(res.status).toBe(400); // validation, not EMAIL_NOT_VERIFIED
    });

    it('blocks an unverified user when the switch is on, with EMAIL_NOT_VERIFIED', async () => {
      process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
      const { email } = await register();
      const res = await book(await loggedIn(email)).expect(403);
      expect((res.body as ErrorBody).code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('lets a user through once they have verified', async () => {
      process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
      const { email } = await register();
      await untilSent(1);
      await verify(tokenOf(sent[0])).expect(200);
      const res = await book(await loggedIn(email));
      expect(res.status).toBe(400);
    });

    it('does not lock out accounts that were not self-registered', async () => {
      process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
      const passwords = ctx.moduleRef.get(PasswordService);
      await users.create({
        name: 'Older account',
        email: 'older-account@example.com',
        passwordHash: await passwords.hash(PASSWORD),
        role: Role.USER,
      });
      const res = await book(await loggedIn('older-account@example.com'));
      expect(res.status).toBe(400);
    });

    it('still lets an unverified user look around and verify while the switch is on', async () => {
      process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
      const { email } = await register();
      const client = await loggedIn(email);
      await client.get('/api/auth/me').expect(200);
      await client.post('/api/auth/resend-verification').expect(200);
    });
  });
});
