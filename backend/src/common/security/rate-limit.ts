import type { NextFunction, Request, Response } from 'express';

/**
 * A fixed-window counter per client, kept in memory (one API instance, no
 * extra package). Used on login, register, refresh, change-password and
 * uploads so one client cannot flood them (bcrypt work, disk space).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Seconds to wait when over the limit, otherwise 0 (and counts the hit). */
  take(key: string): number {
    const now = this.clock();
    if (this.hits.size > 10_000) this.prune(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }
    if (entry.count >= this.limit) {
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    }
    entry.count += 1;
    return 0;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

/**
 * 429 RATE_LIMITED with Retry-After once a client is over the limit. The
 * budget is per client IP and `name` (default: the request path).
 */
export function rateLimit(limiter: RateLimiter, name?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const wait = limiter.take(`${req.ip ?? 'unknown'}|${name ?? req.path}`);
    if (wait === 0) return next();
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests. Please wait a moment and try again.',
      code: 'RATE_LIMITED',
    });
  };
}

export interface RouteRateLimit {
  method: string;
  /** Matched against the full request path, e.g. /^\/api\/auth\/login$/. */
  path: RegExp;
  /** Requests matching the same rule share one budget per client. */
  name: string;
  limiter: RateLimiter;
}

/** Applies the first matching rule's limit; other requests pass untouched. */
export function routeRateLimits(rules: RouteRateLimit[]) {
  const limited = rules.map((rule) => ({
    ...rule,
    handle: rateLimit(rule.limiter, rule.name),
  }));
  return (req: Request, res: Response, next: NextFunction): void => {
    const rule = limited.find(
      (r) => r.method === req.method && r.path.test(req.path),
    );
    if (!rule) return next();
    rule.handle(req, res, next);
  };
}
