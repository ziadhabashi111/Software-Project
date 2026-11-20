import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { AuthCookiesService } from './auth-cookies.service';
import { TokenService } from './token.service';

function build(values: Record<string, string>) {
  const all = {
    JWT_SECRET: 'a-test-secret-with-more-than-16-chars',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    ...values,
  };
  const config = {
    get: (key: string, fallback?: string) =>
      all[key as keyof typeof all] ?? fallback,
  } as unknown as ConfigService;
  const tokens = new TokenService(new JwtService(), config);
  return new AuthCookiesService(config, tokens);
}

function fakeResponse() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    res: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe('AuthCookiesService (ACC-19)', () => {
  it('sets httpOnly, Secure access and refresh cookies by default', () => {
    const { res, cookie } = fakeResponse();
    build({}).set(res, { accessToken: 'AAA', refreshToken: 'RRR' });

    expect(cookie).toHaveBeenCalledWith('access_token', 'AAA', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000,
    });
    expect(cookie).toHaveBeenCalledWith('refresh_token', 'RRR', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  });

  it('drops Secure only when COOKIE_SECURE is explicitly false (plain-http local dev)', () => {
    const { res, cookie } = fakeResponse();
    build({ COOKIE_SECURE: 'false' }).set(res, {
      accessToken: 'AAA',
      refreshToken: 'RRR',
    });
    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'AAA',
      expect.objectContaining({ secure: false }),
    );
  });

  it('keeps Secure for any other COOKIE_SECURE value', () => {
    const { res, cookie } = fakeResponse();
    build({ COOKIE_SECURE: 'yes' }).set(res, {
      accessToken: 'AAA',
      refreshToken: 'RRR',
    });
    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'AAA',
      expect.objectContaining({ secure: true }),
    );
  });

  it('reads Secure, SameSite and Domain from the environment', () => {
    const { res, cookie } = fakeResponse();
    build({
      COOKIE_SECURE: 'true',
      COOKIE_SAMESITE: 'none',
      COOKIE_DOMAIN: '.example.com',
    }).set(res, { accessToken: 'AAA', refreshToken: 'RRR' });

    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'AAA',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: '.example.com',
      }),
    );
  });

  it('clears both cookies with the same attributes', () => {
    const { res, clearCookie } = fakeResponse();
    build({ COOKIE_SECURE: 'true', COOKIE_SAMESITE: 'strict' }).clear(res);

    const options = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    };
    expect(clearCookie).toHaveBeenCalledWith('access_token', options);
    expect(clearCookie).toHaveBeenCalledWith('refresh_token', options);
  });
});
