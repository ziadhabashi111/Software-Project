import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '../../auth/auth.types';
import { assertCanAccess } from './ownership';

const owner = { id: 'user-1', role: Role.USER };
const stranger = { id: 'user-2', role: Role.USER };
const admin = { id: 'admin-1', role: Role.ADMIN };

describe('assertCanAccess (ACC-11)', () => {
  it('lets the owner through', () => {
    expect(() => assertCanAccess('user-1', owner)).not.toThrow();
  });

  it('compares ids as strings so ObjectIds work', () => {
    const objectIdLike = { toString: () => 'user-1' };
    expect(() => assertCanAccess(objectIdLike, owner)).not.toThrow();
  });

  it('hides the resource from other users with a 404 by default', () => {
    expect(() => assertCanAccess('user-1', stranger)).toThrow(
      NotFoundException,
    );
  });

  it('can answer 403 instead when asked to', () => {
    expect(() =>
      assertCanAccess('user-1', stranger, { deny: 'forbidden' }),
    ).toThrow(ForbiddenException);
  });

  it('lets listed roles through even when they are not the owner', () => {
    expect(() =>
      assertCanAccess('user-1', admin, { allowRoles: [Role.ADMIN] }),
    ).not.toThrow();
  });

  it('does not let roles through that are not listed', () => {
    expect(() =>
      assertCanAccess('user-1', admin, { allowRoles: [Role.HOTEL_MODERATOR] }),
    ).toThrow(NotFoundException);
  });
});
