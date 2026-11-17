import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/auth.types';
import { assertOwnAirline, isOwnAirlineModerator } from './airline-access';

const moderator = { role: Role.AIRLINE_MODERATOR, providerId: 'a1' };

describe('airline moderator access (FLT-01, ACC-13)', () => {
  it('lets a moderator manage their own airline', () => {
    expect(() => assertOwnAirline(moderator, 'a1')).not.toThrow();
  });

  it('blocks a moderator of another airline', () => {
    expect(() => assertOwnAirline(moderator, 'a2')).toThrow(ForbiddenException);
  });

  it('blocks a hotel moderator, a user and an admin from airline edits', () => {
    expect(() =>
      assertOwnAirline({ role: Role.HOTEL_MODERATOR, providerId: 'a1' }, 'a1'),
    ).toThrow(ForbiddenException);
    expect(() => assertOwnAirline({ role: Role.USER }, 'a1')).toThrow(
      ForbiddenException,
    );
    expect(() => assertOwnAirline({ role: Role.ADMIN }, 'a1')).toThrow(
      ForbiddenException,
    );
  });

  it('does not treat a guest as the airline moderator', () => {
    expect(isOwnAirlineModerator(undefined, 'a1')).toBe(false);
  });
});
