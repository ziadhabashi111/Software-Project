import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';

/** True for the hotel's own moderator (linked to exactly one hotel, ACC-13). */
export function isOwnHotelModerator(
  user: Pick<AuthUser, 'role' | 'providerId'> | undefined,
  hotelId: string,
): boolean {
  return (
    user?.role === Role.HOTEL_MODERATOR &&
    user.providerId !== undefined &&
    user.providerId === hotelId
  );
}

/**
 * Reading a hotel's reservations (HTL-22, ACC-11): the hotel's own moderator
 * or an admin (ACC-17). Anyone else gets 403, like the airline side.
 */
export function assertCanViewHotelReservations(
  user: Pick<AuthUser, 'role' | 'providerId'>,
  hotelId: string,
): void {
  if (user.role === Role.ADMIN) return;
  if (!isOwnHotelModerator(user, hotelId)) {
    throw new ForbiddenException(
      'You can only view reservations of your own hotel',
    );
  }
}
