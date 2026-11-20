import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service';
import {
  EmailToken,
  EmailTokenDocument,
  EmailTokenPurpose,
} from '../src/auth/email-tokens/email-token.schema';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.service';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

const OLD_PASSWORD = 'Passw0rdOk';
const NEW_PASSWORD = 'BrandNew1Pass';
const GENERIC =
  'If that email belongs to an account, a reset link has been sent.';

interface ErrorBody {
  errors?: { field: string; messages: string[] }[];
}

const fieldsOf = (res: request.Response): string[] =>
  ((res.body as ErrorBody).errors ?? []).map((e) => e.field);

describe('Forgot and reset password by email (ACC-07, GEN-01-B; real MongoDB in memory)', () => {
  let ctx: TestApp;
  let users: UsersService;
  let tokenModel: Model<EmailTokenDocument>;
  let sent: MailMessage[];
  let counter = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = ctx.moduleRef.get(UsersService);
    tokenModel = ctx.moduleRef.get<Model<EmailTokenDocument>>(
      getModelToken(EmailToken.name),
    );
    // Capture the emails instead of sending them. Registration also sends a
    // verification email (ACC-02); only the reset emails matter here.
    jest
      .spyOn(ctx.moduleRef.get(MailService), 'send')
      .mockImplementation((message) => {
        if (message.subject === 'Reset your password') sent.push(message);
        return Promise.resolve();
      });
  }, 180_000);

  beforeEach(() => {
    sent = [];
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await ctx.close();
  });

  const api = () => request(ctx.server);

  async function registerUser(): Promise<{ id: string; email: string }> {
    counter += 1;
    const email = `reset${counter}@example.com`;
    const res = await api()
      .post('/api/auth/register')
      .send({
        name: 'Reset Person',
        email,
        password: OLD_PASSWORD,
        consent: true,
      })
      .expect(201);
    return { id: (res.body as { id: string }).id, email };
  }

  const login = (email: string, password: string) =>
    api().post('/api/auth/login').send({ email, password });

  /** The email is sent in the background, so wait until it has been captured. */
  async function untilSent(count: number): Promise<void> {
    for (let i = 0; i < 100 && sent.length < count; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(sent.length).toBeGreaterThanOrEqual(count);
  }

  const tokenOf = (message: MailMessage): string =>
    /token=([A-Za-z0-9_-]+)/.exec(message.text)![1];

  /** Asks for a link and returns its token. */
  async function requestLink(email: string): Promise<string> {
    const before = sent.length;
    await api().post('/api/auth/forgot-password').send({ email }).expect(200);
    await untilSent(before + 1);
    return tokenOf(sent[sent.length - 1]);
  }

  const reset = (token: string, newPassword = NEW_PASSWORD) =>
    api().post('/api/auth/reset-password').send({ token, newPassword });

  describe('POST /api/auth/forgot-password', () => {
    it('emails a 30-minute link to a registered address', async () => {
      const { email } = await registerUser();
      const res = await api()
        .post('/api/auth/forgot-password')
        .send({ email })
        .expect(200);
      expect((res.body as { message: string }).message).toBe(GENERIC);

      await untilSent(1);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(email);
      expect(sent[0].text).toContain('/reset-password?token=');
      expect(sent[0].text).toContain('30 minutes');
    });

    // The answer must be identical, so it cannot be used to find out which
    // addresses have an account.
    it('answers an unknown address exactly like a known one, and sends nothing', async () => {
      const { email } = await registerUser();
      const known = await api()
        .post('/api/auth/forgot-password')
        .send({ email });
      const unknown = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody-at-all@example.com' });

      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      await untilSent(1);
      expect(sent.map((m) => m.to)).toEqual([email]);
    });

    it('treats the address case-insensitively', async () => {
      const { email } = await registerUser();
      await api()
        .post('/api/auth/forgot-password')
        .send({ email: email.toUpperCase() })
        .expect(200);
      await untilSent(1);
      expect(sent[0].to).toBe(email);
    });

    it('sends nothing to a suspended account', async () => {
      const { id, email } = await registerUser();
      await users.setStatus(id, UserStatus.SUSPENDED);
      await api().post('/api/auth/forgot-password').send({ email }).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(sent).toHaveLength(0);
    });

    it('rejects a malformed email and unknown fields', async () => {
      const bad = await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(fieldsOf(bad)).toContain('email');
      await api()
        .post('/api/auth/forgot-password')
        .send({ email: 'a@example.com', extra: 1 })
        .expect(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('sets the new password: the new one logs in, the old one no longer does', async () => {
      const { email } = await registerUser();
      const token = await requestLink(email);

      await reset(token).expect(200);
      await login(email, NEW_PASSWORD).expect(200);
      await login(email, OLD_PASSWORD).expect(401);
    });

    // Single-use even when it is replayed straight away.
    it('works once: using the same link again answers 400', async () => {
      const { email } = await registerUser();
      const token = await requestLink(email);
      await reset(token).expect(200);
      const again = await reset(token, 'AnotherPass2').expect(400);
      expect(fieldsOf(again)).toContain('token');
      await login(email, NEW_PASSWORD).expect(200);
    });

    it('lets only one of two parallel uses succeed', async () => {
      const { email } = await registerUser();
      const token = await requestLink(email);
      const results = await Promise.all([
        reset(token, 'FirstPass1abc'),
        reset(token, 'SecondPass2abc'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('invalidates an older link when a newer one is requested', async () => {
      const { email } = await registerUser();
      const older = await requestLink(email);
      const newer = await requestLink(email);
      expect(newer).not.toBe(older);

      await reset(older).expect(400);
      await reset(newer).expect(200);
    });

    it('rejects an expired link', async () => {
      const { id, email } = await registerUser();
      const token = await requestLink(email);
      await tokenModel.updateOne(
        { user: id, purpose: EmailTokenPurpose.PASSWORD_RESET },
        { expiresAt: new Date(Date.now() - 1000) },
      );
      const res = await reset(token).expect(400);
      expect(fieldsOf(res)).toContain('token');
      await login(email, OLD_PASSWORD).expect(200); // password untouched
    });

    it('rejects an unknown or malformed token', async () => {
      await reset('this-token-never-existed').expect(400);
      await reset('x'.repeat(300)).expect(400);
      await api()
        .post('/api/auth/reset-password')
        .send({ newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('applies the password rules and keeps the link usable after a rejected password', async () => {
      const { email } = await registerUser();
      const token = await requestLink(email);
      const weak = await reset(token, 'short').expect(400);
      expect(fieldsOf(weak)).toContain('newPassword');
      await reset(token).expect(200); // the link was not used up by the bad attempt
    });

    // A stolen session must not survive a password reset.
    it('signs the account out everywhere', async () => {
      const { email } = await registerUser();
      const device = request.agent(ctx.server);
      await device
        .post('/api/auth/login')
        .send({ email, password: OLD_PASSWORD })
        .expect(200);
      await device.get('/api/auth/me').expect(200);

      await reset(await requestLink(email)).expect(200);
      await device.get('/api/auth/me').expect(401);
    });

    it('clears a login lock from earlier failed attempts', async () => {
      const { email } = await registerUser();
      for (let i = 0; i < 5; i += 1) await login(email, 'WrongPass1x');
      await login(email, OLD_PASSWORD).expect(429); // locked

      await reset(await requestLink(email)).expect(200);
      await login(email, NEW_PASSWORD).expect(200);
    });

    it('clears a forced password change from a temporary password', async () => {
      const { id, email } = await registerUser();
      const passwords = ctx.moduleRef.get(PasswordService);
      await users.setTemporaryPassword(
        id,
        await passwords.hash('Temp1234pass'),
      );
      const before = await login(email, 'Temp1234pass').expect(200);
      expect(
        (before.body as { mustChangePassword: boolean }).mustChangePassword,
      ).toBe(true);

      await reset(await requestLink(email)).expect(200);
      const after = await login(email, NEW_PASSWORD).expect(200);
      expect(
        (after.body as { mustChangePassword: boolean }).mustChangePassword,
      ).toBe(false);
    });

    // A link made before a suspension must not let the user back in.
    it('refuses a link whose account was suspended meanwhile', async () => {
      const { id, email } = await registerUser();
      const token = await requestLink(email);
      await users.setStatus(id, UserStatus.SUSPENDED);
      await reset(token).expect(400);
    });

    it('never stores the token itself, only its hash', async () => {
      const { id, email } = await registerUser();
      const token = await requestLink(email);
      const stored = await tokenModel
        .findOne({ user: id, purpose: EmailTokenPurpose.PASSWORD_RESET })
        .lean();
      expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(token);
    });
  });
});
