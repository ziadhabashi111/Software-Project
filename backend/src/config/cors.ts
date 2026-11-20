import type { ConfigService } from '@nestjs/config';

/** The Next.js dev server; only used when FRONTEND_URL is unset outside production. */
export const DEV_FRONTEND_URL = 'http://localhost:3001';

/**
 * The single origin allowed to call the API with the auth cookies. Read from
 * the validated configuration (FRONTEND_URL is required in production by
 * `validateEnv`), never guessed in production.
 */
export function corsOrigin(config: ConfigService): string {
  const url = config.get<string>('FRONTEND_URL');
  if (url) return url.replace(/\/+$/, '');
  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('FRONTEND_URL must be set in production');
  }
  return DEV_FRONTEND_URL;
}
