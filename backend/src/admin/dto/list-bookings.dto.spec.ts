import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BookingStatus } from '../../common/booking-status/booking-status';
import { ListBookingsQueryDto } from './list-bookings.dto';

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListBookingsQueryDto, query);
  return { dto, invalid: validateSync(dto).map((e) => e.property) };
}

describe('ListBookingsQueryDto status (ACC-17, GEN-11)', () => {
  it.each([
    ['Confirmed', BookingStatus.CONFIRMED],
    ['CONFIRMED', BookingStatus.CONFIRMED],
    ['confirmed', BookingStatus.CONFIRMED],
    ['Pending Payment', BookingStatus.PENDING_PAYMENT],
    [' pending_payment ', BookingStatus.PENDING_PAYMENT],
    ['Cancelled', BookingStatus.CANCELLED],
  ])('accepts %p as %s', (status, expected) => {
    const { dto, invalid } = parse({ status });
    expect(invalid).toEqual([]);
    expect(dto.status).toBe(expected);
  });

  it.each([['Booked'], ['refunded'], [''], ['CONFIRMED; DROP']])(
    'rejects the unknown status %p',
    (status) => {
      expect(parse({ status }).invalid).toEqual(['status']);
    },
  );

  it('leaves the status out when not given', () => {
    const { dto, invalid } = parse({});
    expect(invalid).toEqual([]);
    expect(dto.status).toBeUndefined();
  });
});
