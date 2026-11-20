import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsISO8601, IsOptional, Validate } from 'class-validator';
import { BookingStatus } from '../../common/booking-status/booking-status';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { IsNotBeforeFrom } from '../date-range';

/** `Pending Payment`, `pending_payment` and `PENDING_PAYMENT` are the same status. */
const toStatus = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
    : value;

/** Query for `GET /api/admin/bookings` (ACC-17). */
export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['flight', 'hotel'] })
  @IsOptional()
  @IsIn(['flight', 'hotel'])
  type?: 'flight' | 'hotel';

  @ApiPropertyOptional({
    example: 'Confirmed',
    description:
      'Booking status (GEN-11): Pending Payment, Confirmed, Completed, Expired or Cancelled, in any letter case. Anything else is a 400.',
  })
  @IsOptional()
  @Transform(toStatus)
  @IsEnum(BookingStatus, {
    message:
      'Status must be Pending Payment, Confirmed, Completed, Expired or Cancelled',
  })
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2027-01-01',
    description:
      'Start of the range on the booking start date (departure or check-in). YYYY-MM-DD or a full ISO timestamp.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2027-01-31',
    description:
      'End of the range (inclusive). A plain date covers that whole day (UTC).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Validate(IsNotBeforeFrom)
  to?: string;
}
