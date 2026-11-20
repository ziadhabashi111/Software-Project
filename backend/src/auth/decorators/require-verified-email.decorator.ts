import { SetMetadata } from '@nestjs/common';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../auth.constants';

/**
 * Marks a route that creates a booking (ACC-02). When
 * `EMAIL_VERIFICATION_REQUIRED=true`, a user whose email is not verified yet
 * is refused with `EMAIL_NOT_VERIFIED`. With the switch off (the default) the
 * mark does nothing.
 */
export const RequireVerifiedEmail = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
