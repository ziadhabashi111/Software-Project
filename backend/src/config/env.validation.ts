import { DURATION_PATTERN } from '../common/utils/duration';

const REQUIRED = ['MONGODB_URI', 'JWT_SECRET'] as const;

/**
 * Fails fast at startup when required settings are missing or still contain
 * the placeholder text from `.env.example`.
 * Stripe / FXRatesAPI keys are validated by the modules that use them.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const problems: string[] = [];

  for (const key of REQUIRED) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${key} is missing`);
    } else if (value.trim().startsWith('<')) {
      problems.push(`${key} still has the placeholder value from .env.example`);
    }
  }

  const secret = config.JWT_SECRET;
  if (typeof secret === 'string' && secret.length > 0 && secret.length < 16) {
    problems.push('JWT_SECRET must be at least 16 characters');
  }

  const sameSite = config.COOKIE_SAMESITE;
  if (sameSite !== undefined) {
    if (sameSite !== 'lax' && sameSite !== 'strict' && sameSite !== 'none') {
      problems.push('COOKIE_SAMESITE must be one of lax, strict, none');
    } else if (sameSite === 'none' && config.COOKIE_SECURE === 'false') {
      problems.push(
        'COOKIE_SECURE must be true when COOKIE_SAMESITE is none (browsers drop such cookies)',
      );
    }
  }

  // The only CORS origin (credentials: true), so it is never guessed in production.
  const frontend = config.FRONTEND_URL;
  if (frontend === undefined || frontend === '') {
    if (config.NODE_ENV === 'production') {
      problems.push('FRONTEND_URL is required when NODE_ENV is production');
    }
  } else if (
    typeof frontend !== 'string' ||
    !/^https?:\/\/[^\s/]+/.test(frontend)
  ) {
    problems.push(
      'FRONTEND_URL must be an http(s) URL such as http://localhost:3001',
    );
  }

  for (const key of ['JWT_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN'] as const) {
    const value = config[key];
    if (
      value !== undefined &&
      (typeof value !== 'string' || !DURATION_PATTERN.test(value))
    ) {
      problems.push(`${key} must look like 30s, 15m, 1h or 7d`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment (copy .env.example to backend/.env):\n - ${problems.join('\n - ')}`,
    );
  }
  return config;
}
