import type { Role } from '../auth/auth.types';
import type { UserDocument } from './schemas/user.schema';
import type { UserStatus } from './user-status';

/** What the API returns about a user. Never includes the password hash. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  phone?: string;
  preferredCurrency?: string;
  providerId?: string;
  mustChangePassword: boolean;
  createdAt: Date;
}

export function toProfile(user: UserDocument): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.preferredCurrency
      ? { preferredCurrency: user.preferredCurrency }
      : {}),
    ...(user.providerId ? { providerId: user.providerId.toString() } : {}),
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}
