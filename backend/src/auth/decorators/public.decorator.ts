import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth.constants';

/**
 * Opens a route to guests. Every route is protected by default; a logged-in
 * user is still identified on public routes (`@CurrentUser()` may be set).
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
