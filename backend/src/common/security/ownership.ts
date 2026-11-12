import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser, Role } from '../../auth/auth.types';

export interface AccessOptions {
  /** Roles that may access the resource even when they are not the owner. */
  allowRoles?: Role[];
  /** Hide the resource with a 404 (default) or answer 403 (ACC-11). */
  deny?: 'notFound' | 'forbidden';
}

/**
 * Ownership check for bookings, private itineraries and the like. Call it in
 * the service after loading the resource. Ids are compared as strings so
 * Mongo ObjectIds work.
 */
export function assertCanAccess(
  ownerId: string | { toString(): string },
  user: Pick<AuthUser, 'id' | 'role'>,
  options: AccessOptions = {},
): void {
  if (ownerId.toString() === user.id) return;
  if (options.allowRoles?.includes(user.role)) return;

  if (options.deny === 'forbidden') {
    throw new ForbiddenException('You do not have access to this resource');
  }
  throw new NotFoundException('Resource not found');
}
