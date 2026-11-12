/* Reflector reads decorator metadata from the prototype methods, so the tests
   reference them directly (not bound). */
/* eslint-disable @typescript-eslint/unbound-method */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { Role } from './auth.types';
import type { AuthUser } from './auth.types';
import { Public } from './decorators/public.decorator';
import { TokenService } from './token.service';

class Probe {
  @Public()
  open(): void {}

  secured(): void {}
}

const config = {
  get: (key: string, fallback?: string) =>
    key === 'JWT_SECRET' ? 'a-test-secret-with-more-than-16-chars' : fallback,
} as unknown as ConfigService;

const tokens = new TokenService(new JwtService(), config);
const guard = new AuthGuard(new Reflector(), tokens);
const user: AuthUser = { id: 'user-1', role: Role.USER };

function contextFor(
  handler: () => void,
  cookies: Record<string, string> | undefined,
): {
  context: ExecutionContext;
  request: { cookies?: Record<string, string>; user?: AuthUser };
} {
  const request: { cookies?: Record<string, string>; user?: AuthUser } = {
    cookies,
  };
  const context = {
    getHandler: () => handler,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('AuthGuard (ACC-19)', () => {
  // Reflector reads decorator metadata from the original prototype methods.
  const securedHandler = Probe.prototype.secured;
  const openHandler = Probe.prototype.open;

  it('denies protected routes without a token', () => {
    const { context } = contextFor(securedHandler, {});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('denies protected routes when cookies are missing entirely', () => {
    const { context } = contextFor(securedHandler, undefined);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('lets a valid access token through and exposes the user', () => {
    const { context, request } = contextFor(securedHandler, {
      access_token: tokens.signAccessToken(user),
    });
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(user);
  });

  it('rejects a refresh token sent as the access cookie', () => {
    const { context } = contextFor(securedHandler, {
      access_token: tokens.signRefreshToken(user),
    });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an invalid token on a protected route', () => {
    const { context } = contextFor(securedHandler, { access_token: 'garbage' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('lets guests through public routes without a user', () => {
    const { context, request } = contextFor(openHandler, {});
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('still identifies a logged-in user on public routes', () => {
    const { context, request } = contextFor(openHandler, {
      access_token: tokens.signAccessToken(user),
    });
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(user);
  });

  it('treats a bad token on a public route as a guest', () => {
    const { context, request } = contextFor(openHandler, {
      access_token: 'garbage',
    });
    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBeUndefined();
  });
});
