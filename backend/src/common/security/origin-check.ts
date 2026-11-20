import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie auth: a browser always sends `Origin` on a
 * cross-site POST/PUT/PATCH/DELETE, so a state-changing request whose
 * Origin is neither the frontend nor the API itself (Swagger UI) is refused.
 * Requests without Origin (Stripe's webhook, server-to-server, tools) pass;
 * they carry no browser cookies to abuse. Matters most with SameSite=none.
 */
export function originCheck(frontendOrigin: string) {
  const allowed = frontendOrigin.replace(/\/+$/, '');
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || !origin) return next();
    if (origin === allowed || sameHost(origin, req.get('host'))) return next();
    res.status(403).json({
      statusCode: 403,
      error: 'Forbidden',
      message: 'This request is not allowed from this site',
      code: 'ORIGIN_NOT_ALLOWED',
    });
  };
}

function sameHost(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
