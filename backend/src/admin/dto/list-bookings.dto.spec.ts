import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListBookingsQueryDto } from './list-bookings.dto';

async function statusErrors(status: string): Promise<number> {
  const dto = plainToInstance(ListBookingsQueryDto, { status });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'status').length;
}

describe('ListBookingsQueryDto status filter (GEN-11, ACC-17)', () => {
  it.each([
    'PENDING_PAYMENT',
    'CONFIRMED',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
  ])('accepts the shared booking status %s', async (status) => {
    expect(await statusErrors(status)).toBe(0);
  });

  it.each(['Confirmed', 'Pending Payment', 'nonsense'])(
    'rejects %s, which is not a booking status value',
    async (status) => {
      expect(await statusErrors(status)).toBe(1);
    },
  );
});
