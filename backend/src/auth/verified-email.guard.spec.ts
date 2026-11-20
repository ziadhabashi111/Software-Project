import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { Role } from './auth.types';
import { RequireVerifiedEmail } from './decorators/require-verified-email.decorator';
import { VerifiedEmailGuard } from './verified-email.guard';
import type { UsersService } from '../users/users.service';

const USER_ID = new Types.ObjectId().toString();

class Routes {
  @RequireVerifiedEmail()
  guarded(): void {}

  open(): void {}
}

function context(
  handler: () => void,
  // `null` means nobody is logged in (a default would replace `undefined`).
  user: { id: string; role: Role } | null = {
    id: USER_ID,
    role: Role.USER,
  },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({ user: user ?? undefined }),
    }),
  } as unknown as ExecutionContext;
}

function build(options: {
  flag?: string;
  user?: { emailVerified: boolean } | null;
}) {
  const users = {
    findById: jest
      .fn()
      .mockResolvedValue(
        options.user === undefined ? { emailVerified: false } : options.user,
      ),
  };
  const config = {
    get: (key: string) =>
      key === 'EMAIL_VERIFICATION_REQUIRED' ? options.flag : undefined,
  } as unknown as ConfigService;
  const guard = new VerifiedEmailGuard(
    new Reflector(),
    config,
    users as unknown as UsersService,
  );
  return { guard, users };
}

describe('VerifiedEmailGuard (ACC-02)', () => {
  // The original methods, not bound copies: the decorator's mark is stored on
  // the function itself, and `bind` would make a new function without it.
  const handler = (name: 'guarded' | 'open'): (() => void) =>
    Object.getOwnPropertyDescriptor(Routes.prototype, name)!
      .value as () => void;
  const guarded = handler('guarded');
  const open = handler('open');

  // The default: nobody is blocked, so graders and teammates can book locally
  // without reading an inbox.
  it.each([undefined, 'false', '1', 'yes', ''])(
    'lets everyone through when EMAIL_VERIFICATION_REQUIRED is %p',
    async (flag) => {
      const { guard, users } = build({ flag });
      await expect(guard.canActivate(context(guarded))).resolves.toBe(true);
      expect(users.findById).not.toHaveBeenCalled();
    },
  );

  it('does not look at routes that are not marked, even when the switch is on', async () => {
    const { guard, users } = build({ flag: 'true' });
    await expect(guard.canActivate(context(open))).resolves.toBe(true);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('lets a verified user through a marked route', async () => {
    const { guard, users } = build({
      flag: 'true',
      user: { emailVerified: true },
    });
    await expect(guard.canActivate(context(guarded))).resolves.toBe(true);
    expect(users.findById).toHaveBeenCalledWith(USER_ID);
  });

  it('blocks an unverified user with EMAIL_NOT_VERIFIED', async () => {
    const { guard } = build({ flag: 'true' });
    const error = await guard
      .canActivate(context(guarded))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('answers 401 when the account no longer exists', async () => {
    const { guard } = build({ flag: 'true', user: null });
    await expect(guard.canActivate(context(guarded))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // The login guard runs first and sets the user. If this guard ever ran
  // before it (a wrong guard order), skipping the check would quietly turn the
  // block off, so it refuses instead.
  it('refuses with 401, never passes, when no logged-in user is set', async () => {
    const { guard, users } = build({ flag: 'true' });
    await expect(
      guard.canActivate(context(guarded, null)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findById).not.toHaveBeenCalled();
  });
});
