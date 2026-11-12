import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCESS_COOKIE, IS_PUBLIC_KEY } from './auth.constants';
import type { AuthenticatedRequest } from './auth.types';
import { TokenService } from './token.service';

/**
 * Global guard: every route needs a valid access cookie unless it is marked
 * `@Public()`. On public routes a valid token still identifies the user.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[
      ACCESS_COOKIE
    ];

    if (token) {
      try {
        request.user = this.tokens.verifyAccessToken(token);
        return true;
      } catch (error) {
        if (!isPublic) throw error;
        return true;
      }
    }

    if (isPublic) return true;
    throw new UnauthorizedException('Authentication required');
  }
}
