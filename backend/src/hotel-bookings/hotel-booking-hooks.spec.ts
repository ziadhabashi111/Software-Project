import { parseStatus } from './hotel-booking-hooks';
import { ReservationStatus } from './reservation-status';

describe('admin booking status filter (ACC-17)', () => {
  it.each([
    ['Confirmed', ReservationStatus.CONFIRMED],
    ['CONFIRMED', ReservationStatus.CONFIRMED],
    ['Pending Payment', ReservationStatus.PENDING_PAYMENT],
    ['pending_payment', ReservationStatus.PENDING_PAYMENT],
    [' cancelled ', ReservationStatus.CANCELLED],
    ['Completed', ReservationStatus.COMPLETED],
    ['expired', ReservationStatus.EXPIRED],
  ])('reads %p as %s', (input, status) => {
    expect(parseStatus(input)).toBe(status);
  });

  it.each(['Booked', '', 'CONFIRMED;DROP'])('rejects %p', (input) => {
    expect(parseStatus(input)).toBeNull();
  });
});
