import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from './auth.types';
import { TokenService } from './token.service';

function configWith(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`${key} missing`);
      return value;
    },
  } as unknown as ConfigService;
}

const baseConfig = {
  JWT_SECRET: 'a-test-secret-with-more-than-16-chars',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

function service(values: Record<string, string> = baseConfig): TokenService {
  return new TokenService(new JwtService(), configWith(values));
}

const user = { id: 'user-1', role: Role.USER };

describe('TokenService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('round-trips an access token', () => {
    const tokens = service();
    const decoded = tokens.verifyAccessToken(tokens.signAccessToken(user));
    expect(decoded).toEqual(user);
  });

  it('keeps the provider of a moderator in the token', () => {
    const tokens = service();
    const moderator = {
      id: 'mod-1',
      role: Role.HOTEL_MODERATOR,
      providerId: 'hotel-9',
    };
    expect(tokens.verifyAccessToken(tokens.signAccessToken(moderator))).toEqual(
      moderator,
    );
  });

  it('does not accept a refresh token as an access token (and vice versa)', () => {
    const tokens = service();
    expect(() =>
      tokens.verifyAccessToken(tokens.signRefreshToken(user)),
    ).toThrow(UnauthorizedException);
    expect(() =>
      tokens.verifyRefreshToken(tokens.signAccessToken(user)),
    ).toThrow(UnauthorizedException);
    expect(tokens.verifyRefreshToken(tokens.signRefreshToken(user))).toEqual(
      user,
    );
  });

  it('rejects tampered tokens and tokens signed with another secret', () => {
    const tokens = service();
    const other = service({
      ...baseConfig,
      JWT_SECRET: 'another-secret-value-1234',
    });
    expect(() => tokens.verifyAccessToken('not.a.jwt')).toThrow(
      UnauthorizedException,
    );
    expect(() => tokens.verifyAccessToken(other.signAccessToken(user))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired tokens', () => {
    jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
    const tokens = service();
    const token = tokens.signAccessToken(user);
    jest.setSystemTime(new Date('2026-11-12T10:16:00Z'));
    expect(() => tokens.verifyAccessToken(token)).toThrow(
      UnauthorizedException,
    );
  });

  it('exposes the token lifetimes in milliseconds for cookies', () => {
    const tokens = service();
    expect(tokens.accessTtlMs).toBe(15 * 60 * 1000);
    expect(tokens.refreshTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('falls back to a short access token and a 7 day refresh token', () => {
    const tokens = service({ JWT_SECRET: baseConfig.JWT_SECRET });
    expect(tokens.accessTtlMs).toBe(15 * 60 * 1000);
    expect(tokens.refreshTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
