import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/auth.types';
import {
  assertCanViewHotelReservations,
  assertOwnHotel,
  isOwnHotelModerator,
} from './hotel-access';

const moderator = { role: Role.HOTEL_MODERATOR, providerId: 'h1' };

describe('hotel reservations access (HTL-22, ACC-11)', () => {
  it('lets a hotel moderator view their own hotel', () => {
    expect(() => assertCanViewHotelReservations(moderator, 'h1')).not.toThrow();
  });

  it('lets an admin view any hotel', () => {
    expect(() =>
      assertCanViewHotelReservations({ role: Role.ADMIN }, 'h2'),
    ).not.toThrow();
  });

  it('blocks the moderator of another hotel', () => {
    expect(() => assertCanViewHotelReservations(moderator, 'h2')).toThrow(
      ForbiddenException,
    );
  });

  it('blocks an airline moderator with the same provider id, a user and a moderator without a hotel', () => {
    expect(() =>
      assertCanViewHotelReservations(
        { role: Role.AIRLINE_MODERATOR, providerId: 'h1' },
        'h1',
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanViewHotelReservations({ role: Role.USER }, 'h1'),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertCanViewHotelReservations({ role: Role.HOTEL_MODERATOR }, 'h1'),
    ).toThrow(ForbiddenException);
  });

  it('does not treat a guest as the hotel moderator', () => {
    expect(isOwnHotelModerator(undefined, 'h1')).toBe(false);
  });
});

describe('managing a hotel (HTL-01, 03..06: a moderator manages only their own hotel)', () => {
  it('lets the moderator of that hotel manage it', () => {
    expect(() => assertOwnHotel(moderator, 'h1')).not.toThrow();
  });

  it('blocks everyone else, admins included: the catalogue is the moderator’s', () => {
    expect(() => assertOwnHotel(moderator, 'h2')).toThrow(ForbiddenException);
    expect(() => assertOwnHotel({ role: Role.ADMIN }, 'h1')).toThrow(
      ForbiddenException,
    );
    expect(() => assertOwnHotel({ role: Role.USER }, 'h1')).toThrow(
      ForbiddenException,
    );
    expect(() =>
      assertOwnHotel({ role: Role.AIRLINE_MODERATOR, providerId: 'h1' }, 'h1'),
    ).toThrow(ForbiddenException);
    expect(() => assertOwnHotel({ role: Role.HOTEL_MODERATOR }, 'h1')).toThrow(
      ForbiddenException,
    );
  });
});
