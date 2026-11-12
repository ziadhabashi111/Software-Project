import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../auth.constants';
import type { Role } from '../auth.types';

/** Restricts a route to the listed roles (403 for everyone else). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
