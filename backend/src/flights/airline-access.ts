import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';

/** True for the airline's own moderator. */
export function isOwnAirlineModerator(
  user: Pick<AuthUser, 'role' | 'providerId'> | undefined,
  airlineId: string,
): boolean {
  return user?.role === Role.AIRLINE_MODERATOR && user.providerId === airlineId;
}

/**
 * An airline moderator manages exactly one airline (ACC-13). Call this in
 * every service method that changes an airline or its flights.
 */
export function assertOwnAirline(
  user: Pick<AuthUser, 'role' | 'providerId'>,
  airlineId: string,
): void {
  if (!isOwnAirlineModerator(user, airlineId)) {
    throw new ForbiddenException('You can only manage your own airline');
  }
}
