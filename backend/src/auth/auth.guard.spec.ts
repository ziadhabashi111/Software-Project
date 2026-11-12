/* Reflector reads decorator metadata from the prototype methods, so the tests
   reference them directly (not bound). */
/* eslint-disable @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { Role } from './auth.types';
import type { AuthUser } from './auth.types';
import { AllowPasswordChange } from './decorators/allow-password-change.decorator';
import { Public } from './decorators/public.decorator';
import type { SessionValidator } from './session-validator';
import { TokenService } from './token.service';

class Probe {
  @Public()
  open(): void {}

  secured(): void {}

  @AllowPasswordChange()
  allowedWhilePasswordChangeIsPending(): void {}
}

const config = {
  get: (key: string, fallback?: string) =>
    key === 'JWT_SECRET' ? 'a-test-secret-with-more-than-16-chars' : fallback,
} as unknown as ConfigService;

const tokens = new TokenService(new JwtService(), config);
const user: AuthUser = { id: 'user-1', role: Role.USER };

type FakeRequest = { cookies?: Record<string, string>; user?: AuthUser };

function contextFor(
  handler: () => void,
  cookies: Record<string, string> | undefined,
): { context: ExecutionContext; request: FakeRequest } {
  const request: FakeRequest = { cookies };
  const context = {
    getHandler: () => handler,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

// Reflector reads decorator metadata from the original prototype methods.
const securedHandler = Probe.prototype.secured;
const openHandler = Probe.prototype.open;
const allowedHandler = Probe.prototype.allowedWhilePasswordChangeIsPending;

describe('AuthGuard without session storage (ACC-19)', () => {
  const guard = new AuthGuard(new Reflector(), tokens);

  it('denies protected routes without a token', async () => {
    const { context } = contextFor(securedHandler, {});
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('denies protected routes when cookies are missing entirely', async () => {
    const { context } = contextFor(securedHandler, undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('lets a valid access token through and exposes the user', async () => {
    const { context, request } = contextFor(securedHandler, {
      access_token: tokens.signAccessToken(user),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(user);
  });

  it('rejects a refresh token sent as the access cookie', async () => {
    const { context } = contextFor(securedHandler, {
      access_token: tokens.signRefreshToken(user, 'jti'),
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an invalid token on a protected route', async () => {
    const { context } = contextFor(securedHandler, { access_token: 'garbage' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('lets guests through public routes without a user', async () => {
    const { context, request } = contextFor(openHandler, {});
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('still identifies a logged-in user on public routes', async () => {
    const { context, request } = contextFor(openHandler, {
      access_token: tokens.signAccessToken(user),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(user);
  });

  it('treats a bad token on a public route as a guest', async () => {
    const { context, request } = contextFor(openHandler, {
      access_token: 'garbage',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });
});

describe('AuthGuard with session storage (ACC-06)', () => {
  const validator: SessionValidator = {
    validateAndTouch: (sessionId: string) =>
      Promise.resolve(sessionId === 'live'),
  };
  const guard = new AuthGuard(new Reflector(), tokens, validator);

  it('lets a token with a live session through', async () => {
    const { context, request } = contextFor(securedHandler, {
      access_token: tokens.signAccessToken({ ...user, sessionId: 'live' }),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user?.sessionId).toBe('live');
  });

  it('rejects a token whose session was revoked or expired', async () => {
    const { context } = contextFor(securedHandler, {
      access_token: tokens.signAccessToken({ ...user, sessionId: 'dead' }),
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token without a session id', async () => {
    const { context } = contextFor(securedHandler, {
      access_token: tokens.signAccessToken(user),
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('treats a dead session on a public route as a guest', async () => {
    const { context, request } = contextFor(openHandler, {
      access_token: tokens.signAccessToken({ ...user, sessionId: 'dead' }),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });
});

describe('AuthGuard with a pending password change (ACC-07a, ACC-13)', () => {
  const guard = new AuthGuard(new Reflector(), tokens);
  const pending = tokens.signAccessToken({ ...user, mustChangePassword: true });

  it('blocks protected routes until the password is changed', async () => {
    const { context } = contextFor(securedHandler, { access_token: pending });
    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }),
    );
  });

  it('allows routes marked @AllowPasswordChange', async () => {
    const { context } = contextFor(allowedHandler, { access_token: pending });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('does not affect public routes', async () => {
    const { context } = contextFor(openHandler, { access_token: pending });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
