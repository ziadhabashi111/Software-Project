import type { ConfigService } from '@nestjs/config';
import { corsOrigin, DEV_FRONTEND_URL } from './cors';

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('corsOrigin', () => {
  it('uses FRONTEND_URL from the validated configuration', () => {
    expect(
      corsOrigin(config({ FRONTEND_URL: 'https://travel.example.com' })),
    ).toBe('https://travel.example.com');
  });

  it('drops a trailing slash so it matches the browser Origin header', () => {
    expect(
      corsOrigin(config({ FRONTEND_URL: 'https://travel.example.com/' })),
    ).toBe('https://travel.example.com');
  });

  it('falls back to the local Next.js dev server outside production', () => {
    expect(corsOrigin(config({}))).toBe(DEV_FRONTEND_URL);
    expect(corsOrigin(config({ NODE_ENV: 'development' }))).toBe(
      DEV_FRONTEND_URL,
    );
  });

  it('refuses to guess in production', () => {
    expect(() => corsOrigin(config({ NODE_ENV: 'production' }))).toThrow(
      /FRONTEND_URL/,
    );
  });
});
