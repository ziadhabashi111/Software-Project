import type { Request } from 'express';

export enum Role {
  USER = 'user',
  ADMIN = 'admin',
  AIRLINE_MODERATOR = 'airline_moderator',
  HOTEL_MODERATOR = 'hotel_moderator',
}

/** The logged-in user as seen by controllers (`@CurrentUser()`). */
export interface AuthUser {
  id: string;
  role: Role;
  /** Airline or hotel id for moderators (they manage exactly one provider). */
  providerId?: string;
  /** The login session this token belongs to (inactivity expiry, revocation). */
  sessionId?: string;
  /** Temporary password: only changing it is allowed (ACC-07a, ACC-13). */
  mustChangePassword?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}
