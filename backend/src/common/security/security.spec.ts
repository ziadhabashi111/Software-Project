import type { NextFunction, Request, Response } from 'express';
import { originCheck } from './origin-check';
import { RateLimiter, rateLimit, routeRateLimits } from './rate-limit';
import { securityHeaders } from './security-headers';

function fakeRes() {
  const headers = new Map<string, string>();
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), String(value));
      return res;
    }),
    removeHeader: jest.fn((name: string) => headers.delete(name.toLowerCase())),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };
  return { res, headers };
}

function fakeReq(init: {
  method?: string;
  origin?: string;
  host?: string;
  ip?: string;
  path?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (init.origin) headers.origin = init.origin;
  return {
    method: init.method ?? 'POST',
    headers,
    ip: init.ip ?? '10.0.0.1',
    path: init.path ?? '/api/auth/login',
    get: (name: string) =>
      name.toLowerCase() === 'host'
        ? (init.host ?? 'api.local:3000')
        : undefined,
  } as unknown as Request;
}

describe('security headers', () => {
  it('sets nosniff, frame and referrer headers, and HSTS only in production', () => {
    const dev = fakeRes();
    const next = jest.fn();
    securityHeaders({ production: false })(
      fakeReq({}),
      dev.res as unknown as Response,
      next as NextFunction,
    );
    expect(dev.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dev.headers.get('x-frame-options')).toBe('DENY');
    expect(dev.headers.get('referrer-policy')).toBe('no-referrer');
    expect(dev.headers.has('strict-transport-security')).toBe(false);
    expect(next).toHaveBeenCalled();

    const prod = fakeRes();
    securityHeaders({ production: true })(
      fakeReq({}),
      prod.res as unknown as Response,
      jest.fn() as NextFunction,
    );
    expect(prod.headers.get('strict-transport-security')).toMatch(/max-age=/);
  });
});

describe('origin check (CSRF)', () => {
  const check = originCheck('http://localhost:3001');

  function run(req: Request) {
    const { res } = fakeRes();
    const next = jest.fn();
    check(req, res as unknown as Response, next as NextFunction);
    return { res, next };
  }

  it('lets the frontend, the API itself (Swagger) and non-browser clients change data', () => {
    expect(
      run(fakeReq({ origin: 'http://localhost:3001' })).next,
    ).toHaveBeenCalled();
    expect(
      run(fakeReq({ origin: 'http://api.local:3000', host: 'api.local:3000' }))
        .next,
    ).toHaveBeenCalled();
    // Stripe's webhook and server-to-server calls send no Origin.
    expect(run(fakeReq({})).next).toHaveBeenCalled();
  });

  it('refuses a state-changing request from another site with 403', () => {
    const { res, next } = run(fakeReq({ origin: 'https://evil.example' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('leaves reads alone', () => {
    expect(
      run(fakeReq({ method: 'GET', origin: 'https://evil.example' })).next,
    ).toHaveBeenCalled();
  });
});

describe('rate limit', () => {
  it('allows `limit` requests per window per client, then answers 429 with Retry-After', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 60_000, () => now);
    const middleware = rateLimit(limiter);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { res } = fakeRes();
      const next = jest.fn(() => statuses.push(200));
      middleware(fakeReq({}), res as unknown as Response, next as NextFunction);
      if (!next.mock.calls.length) statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);

    // Another client has its own budget.
    const other = jest.fn();
    middleware(
      fakeReq({ ip: '10.0.0.2' }),
      fakeRes().res as unknown as Response,
      other as NextFunction,
    );
    expect(other).toHaveBeenCalled();

    // A new window starts fresh.
    now = 60_001;
    const later = jest.fn();
    middleware(
      fakeReq({}),
      fakeRes().res as unknown as Response,
      later as NextFunction,
    );
    expect(later).toHaveBeenCalled();
  });

  it('sends the code and Retry-After on a refused request', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    const middleware = rateLimit(limiter);
    middleware(fakeReq({}), fakeRes().res as unknown as Response, jest.fn());
    const { res, headers } = fakeRes();
    middleware(fakeReq({}), res as unknown as Response, jest.fn());
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
    expect(headers.get('retry-after')).toBe('60');
  });
});

describe('route rate limits', () => {
  it('limits only the matching method and path, sharing one budget across ids', () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    const middleware = routeRateLimits([
      {
        method: 'POST',
        path: /^\/api\/posts\/[^/]+\/images$/,
        name: 'uploads',
        limiter,
      },
    ]);
    const call = (method: string, path: string) => {
      const { res } = fakeRes();
      const next = jest.fn();
      middleware(
        fakeReq({ method, path }),
        res as unknown as Response,
        next as NextFunction,
      );
      return next.mock.calls.length ? 200 : res.statusCode;
    };
    expect(call('POST', '/api/posts/a/images')).toBe(200);
    expect(call('POST', '/api/posts/b/images')).toBe(429);
    expect(call('GET', '/api/posts/a/images')).toBe(200);
    expect(call('POST', '/api/posts')).toBe(200);
  });
});
