import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './auth.constants';
import type { AuthenticatedRequest, Role } from './auth.types';

/** Enforces `@Roles(...)`; routes without it are open to any logged-in user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        'You do not have permission for this action',
      );
    }
    return true;
  }
}
