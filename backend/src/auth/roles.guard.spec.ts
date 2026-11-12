/* Reflector reads decorator metadata from the prototype methods, so the tests
   reference them directly (not bound). */
/* eslint-disable @typescript-eslint/unbound-method */
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './auth.types';
import type { AuthUser } from './auth.types';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

class Probe {
  anyLoggedIn(): void {}

  @Roles(Role.ADMIN)
  adminOnly(): void {}

  @Roles(Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR)
  moderators(): void {}
}

const guard = new RolesGuard(new Reflector());

function contextFor(handler: () => void, user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows routes without @Roles for anyone', () => {
    expect(guard.canActivate(contextFor(Probe.prototype.anyLoggedIn))).toBe(
      true,
    );
  });

  it('allows a user with a listed role', () => {
    const admin = { id: 'a', role: Role.ADMIN };
    expect(
      guard.canActivate(contextFor(Probe.prototype.adminOnly, admin)),
    ).toBe(true);
    const hotel = { id: 'h', role: Role.HOTEL_MODERATOR };
    expect(
      guard.canActivate(contextFor(Probe.prototype.moderators, hotel)),
    ).toBe(true);
  });

  it('answers 403 when the role is not listed', () => {
    const user = { id: 'u', role: Role.USER };
    expect(() =>
      guard.canActivate(contextFor(Probe.prototype.adminOnly, user)),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(contextFor(Probe.prototype.moderators, user)),
    ).toThrow(ForbiddenException);
  });

  it('answers 401 when a role is required but nobody is logged in', () => {
    expect(() =>
      guard.canActivate(contextFor(Probe.prototype.adminOnly)),
    ).toThrow(UnauthorizedException);
  });
});
