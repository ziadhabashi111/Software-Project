import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCESS_COOKIE,
  ALLOW_PASSWORD_CHANGE_KEY,
  IS_PUBLIC_KEY,
} from './auth.constants';
import type { AuthenticatedRequest, AuthUser } from './auth.types';
import { SESSION_VALIDATOR } from './session-validator';
import type { SessionValidator } from './session-validator';
import { TokenService } from './token.service';

/**
 * Global guard: every route needs a valid access cookie unless it is marked
 * `@Public()`. On public routes a valid token still identifies the user.
 * When a session store is available the session must also be alive, which
 * gives the 30 minute inactivity expiry (ACC-06).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Optional()
    @Inject(SESSION_VALIDATOR)
    private readonly sessions?: SessionValidator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[
      ACCESS_COOKIE
    ];

    if (token) {
      let user: AuthUser;
      try {
        user = await this.authenticate(token);
      } catch (error) {
        if (!isPublic) throw error;
        return true;
      }
      request.user = user;
      if (!isPublic) this.assertNoPasswordChangePending(context, user);
      return true;
    }

    if (isPublic) return true;
    throw new UnauthorizedException('Authentication required');
  }

  private async authenticate(token: string): Promise<AuthUser> {
    const user = this.tokens.verifyAccessToken(token);
    if (this.sessions) {
      const alive =
        !!user.sessionId &&
        (await this.sessions.validateAndTouch(user.sessionId, user.id));
      if (!alive) throw new UnauthorizedException('Session expired');
    }
    return user;
  }

  private assertNoPasswordChangePending(
    context: ExecutionContext,
    user: AuthUser,
  ): void {
    if (!user.mustChangePassword) return;
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return;
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You must change your password before continuing',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
}
