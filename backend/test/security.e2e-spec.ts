import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';

/**
 * The HTTP hardening as the real app applies it (configureApp): security
 * headers, the same-origin check for state changes, and the per-IP rate
 * limit, which the other suites switch off by running with NODE_ENV=test.
 */
describe('HTTP hardening (ACC-05, ACC-19, real HTTP)', () => {
  let ctx: TestApp;
  const previousEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    ctx = await createTestApp();
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
    process.env.NODE_ENV = previousEnv;
  });

  const login = () =>
    request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong1234' });

  it('sends the security headers and hides the framework', async () => {
    const res = await request(ctx.server).get('/api/auth/me');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses a state-changing request from another site', async () => {
    const res = await request(ctx.server)
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect((res.body as { code?: string }).code).toBe('ORIGIN_NOT_ALLOWED');
    await request(ctx.server)
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:3001')
      .expect((r) => expect(r.status).not.toBe(403));
  });

  it('allows 10 logins per minute from one address, then answers 429', async () => {
    for (let i = 0; i < 10; i += 1) await login().expect(401);
    const limited = await login().expect(429);
    expect((limited.body as { code?: string }).code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
  });

  // The reset endpoints send email and take guessable-looking tokens, so one
  // address cannot hammer them.
  it.each(['forgot-password', 'reset-password'])(
    'allows 10 %s requests per minute from one address, then answers 429',
    async (route) => {
      const call = () =>
        request(ctx.server)
          .post(`/api/auth/${route}`)
          .send({ email: 'nobody@example.com', token: 'x', newPassword: 'x' });
      // Any answer except 429 counts: the body may be invalid, the limit still applies.
      for (let i = 0; i < 10; i += 1) {
        const res = await call();
        expect(res.status).not.toBe(429);
      }
      const limited = await call().expect(429);
      expect((limited.body as { code?: string }).code).toBe('RATE_LIMITED');
    },
  );

  // Resending sends an email each time; the verification link takes a secret
  // token. Neither may be hammered from one address.
  it.each([
    ['POST', 'resend-verification', 5],
    ['GET', 'verify-email', 20],
  ] as const)(
    'allows %s /auth/%s %i times per minute from one address, then answers 429',
    async (method, route, limit) => {
      const call = () =>
        method === 'GET'
          ? request(ctx.server).get(`/api/auth/${route}`).query({ token: 'x' })
          : request(ctx.server).post(`/api/auth/${route}`);
      for (let i = 0; i < limit; i += 1) {
        const res = await call();
        expect(res.status).not.toBe(429);
      }
      const limited = await call().expect(429);
      expect((limited.body as { code?: string }).code).toBe('RATE_LIMITED');
    },
  );

  // One person testing several roles in Swagger, or a whole class behind one
  // address, must not be locked out after a handful of sign-ups.
  it('allows 20 registrations per minute from one address, then answers 429', async () => {
    const register = (n: number) =>
      request(ctx.server)
        .post('/api/auth/register')
        .send({
          name: 'Limit Test',
          email: `limit${n}@example.com`,
          password: 'Passw0rdOk',
          consent: true,
        });
    for (let i = 0; i < 20; i += 1) await register(i).expect(201);
    const limited = await register(20).expect(429);
    expect((limited.body as { code?: string }).code).toBe('RATE_LIMITED');
  });
});
