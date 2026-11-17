import {
  BookingStatus,
  canTransition,
  assertCanTransition,
} from './booking-status';
import { ConflictException } from '@nestjs/common';

describe('canTransition', () => {
  it('allows PENDING_PAYMENT to CONFIRMED', () => {
    expect(
      canTransition(BookingStatus.PENDING_PAYMENT, BookingStatus.CONFIRMED),
    ).toBe(true);
  });
  it('allows PENDING_PAYMENT to EXPIRED', () => {
    expect(
      canTransition(BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED),
    ).toBe(true);
  });
  it('allows CONFIRMED to COMPLETED', () => {
    expect(
      canTransition(BookingStatus.CONFIRMED, BookingStatus.COMPLETED),
    ).toBe(true);
  });

  it('allows CONFIRMED to CANCELLED', () => {
    expect(
      canTransition(BookingStatus.CONFIRMED, BookingStatus.CANCELLED),
    ).toBe(true);
  });

  it('CONFIRMED to PENDING_PAYMENT is not allowed', () => {
    expect(
      canTransition(BookingStatus.CONFIRMED, BookingStatus.PENDING_PAYMENT),
    ).toBe(false);
  });

  it('CANCELLED to CONFIRMED is not allowed', () => {
    expect(
      canTransition(BookingStatus.CANCELLED, BookingStatus.CONFIRMED),
    ).toBe(false);
  });

  it('PENDING_PAYMENT to CANCELLED', () => {
    expect(
      canTransition(BookingStatus.PENDING_PAYMENT, BookingStatus.CANCELLED),
    ).toBe(false);
  });
});

describe('assertCanTransition', () => {
  it('throws a 409 when moving CONFIRMED to PENDING_PAYMENT', () => {
    expect(() =>
      assertCanTransition(
        BookingStatus.CONFIRMED,
        BookingStatus.PENDING_PAYMENT,
      ),
    ).toThrow(ConflictException);
  });

  it('throws a 409 when moving EXPIRED to CANCELLED', () => {
    expect(() =>
      assertCanTransition(BookingStatus.EXPIRED, BookingStatus.CANCELLED),
    ).toThrow(ConflictException);
  });

  it('does not throw a 409 when moving PENDING_PAYMENT to EXPIRED', () => {
    expect(() =>
      assertCanTransition(BookingStatus.PENDING_PAYMENT, BookingStatus.EXPIRED),
    ).not.toThrow();
  });

  it('throws a 409 when moving CANCELLED to CONFIRMED', () => {
    expect(() =>
      assertCanTransition(BookingStatus.CANCELLED, BookingStatus.CONFIRMED),
    ).toThrow('Booking cannot change from CANCELLED to CONFIRMED');
  });
});
