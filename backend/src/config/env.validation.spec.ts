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
});
