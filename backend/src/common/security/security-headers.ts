import type { NextFunction, Request, Response } from 'express';

/**
 * Basic security headers without an extra package: no MIME sniffing, no
 * framing (clickjacking, also for Swagger UI), no referrer leaks, and HSTS
 * in production where the API is served over HTTPS.
 */
export function securityHeaders(options: { production: boolean }) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (options.production) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=15552000; includeSubDomains',
      );
    }
    next();
  };
}
