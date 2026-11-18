import { BookingStatus } from '../../common/booking-status/booking-status';
import { parseStatus, statusLabel } from './status-labels';

describe('booking status labels (GEN-11, ACC-17, FLT-29)', () => {
  it.each([
    ['Confirmed', BookingStatus.CONFIRMED],
    ['CONFIRMED', BookingStatus.CONFIRMED],
    ['pending payment', BookingStatus.PENDING_PAYMENT],
    ['Pending-Payment', BookingStatus.PENDING_PAYMENT],
    ['PENDING_PAYMENT', BookingStatus.PENDING_PAYMENT],
    [' expired ', BookingStatus.EXPIRED],
  ])('parses %p', (input, expected) => {
    expect(parseStatus(input)).toBe(expected);
  });

  it('returns null for an unknown status', () => {
    expect(parseStatus('bogus')).toBeNull();
  });

  it('turns a stored status into a display label', () => {
    expect(statusLabel(BookingStatus.PENDING_PAYMENT)).toBe('Pending Payment');
    expect(statusLabel(BookingStatus.CONFIRMED)).toBe('Confirmed');
    expect(statusLabel(BookingStatus.CANCELLED)).toBe('Cancelled');
  });
});
