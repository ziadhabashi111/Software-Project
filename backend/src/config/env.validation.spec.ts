import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const ok = {
    MONGODB_URI: 'mongodb://localhost:27017/test',
    JWT_SECRET: 'a-long-enough-secret-value',
  };

  it('accepts a complete configuration', () => {
    expect(validateEnv(ok)).toEqual(ok);
  });

  it('rejects missing required values', () => {
    expect(() => validateEnv({})).toThrow(/MONGODB_URI is missing/);
    expect(() => validateEnv({})).toThrow(/JWT_SECRET is missing/);
  });

  it('rejects placeholders copied from .env.example', () => {
    expect(() =>
      validateEnv({
        ...ok,
        MONGODB_URI: '<team-mongodb-atlas-connection-string>',
      }),
    ).toThrow(/placeholder/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...ok, JWT_SECRET: 'short' })).toThrow(
      /at least 16/,
    );
  });

  it('accepts the optional cookie and token settings', () => {
    const full = {
      ...ok,
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      COOKIE_SECURE: 'true',
      COOKIE_SAMESITE: 'none',
      COOKIE_DOMAIN: '.example.com',
    };
    expect(validateEnv(full)).toEqual(full);
  });

  it('rejects an unknown COOKIE_SAMESITE value', () => {
    expect(() => validateEnv({ ...ok, COOKIE_SAMESITE: 'sometimes' })).toThrow(
      /COOKIE_SAMESITE/,
    );
  });

  it('rejects SameSite=none without Secure cookies (browsers drop them)', () => {
    expect(() =>
      validateEnv({ ...ok, COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }),
    ).toThrow(/COOKIE_SECURE/);
  });

  it('accepts SameSite=none when COOKIE_SECURE is left at its Secure default', () => {
    expect(() => validateEnv({ ...ok, COOKIE_SAMESITE: 'none' })).not.toThrow();
  });

  it('rejects malformed token lifetimes', () => {
    expect(() => validateEnv({ ...ok, JWT_EXPIRES_IN: 'soon' })).toThrow(
      /JWT_EXPIRES_IN/,
    );
    expect(() =>
      validateEnv({ ...ok, JWT_REFRESH_EXPIRES_IN: '7 days' }),
    ).toThrow(/JWT_REFRESH_EXPIRES_IN/);
  });
});
