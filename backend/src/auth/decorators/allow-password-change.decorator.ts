import { SetMetadata } from '@nestjs/common';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../auth.constants';

/**
 * Lets a user with a temporary password use this route. Everything else is
 * blocked until they change it (ACC-07a, ACC-13). Only the account routes
 * (`me`, `change-password`) need this.
 */
export const AllowPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
