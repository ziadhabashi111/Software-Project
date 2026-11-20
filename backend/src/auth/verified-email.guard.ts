import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../users/users.service';
import { REQUIRE_VERIFIED_EMAIL_KEY } from './auth.constants';
import type { AuthenticatedRequest } from './auth.types';

/**
 * ACC-02: on routes marked `@RequireVerifiedEmail()` (the ones that create a
 * booking), refuses a user whose email is not verified. It only acts when
 * `EMAIL_VERIFICATION_REQUIRED` is exactly `true`; by default nobody is
 * blocked, so booking works locally without reading an inbox. Runs after the
 * login guard, so `request.user` is already set; if it is not, the answer is
 * 401, never a silent pass.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.config.get<string>('EMAIL_VERIFICATION_REQUIRED') !== 'true') {
      return true;
    }
    const marked = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!marked) return true;

    const userId = context.switchToHttp().getRequest<AuthenticatedRequest>()
      .user?.id;
    // The login guard runs first and sets the user. If it did not (a wrong
    // guard order), refuse instead of silently skipping the block.
    if (!userId) throw new UnauthorizedException('Authentication required');

    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Not logged in');
    if (!user.emailVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message:
          'Verify your email address before booking. Open the link we emailed you, or ask for a new one with POST /api/auth/resend-verification.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
    return true;
  }
}
