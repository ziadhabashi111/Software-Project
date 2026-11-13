import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { parseRangeDate } from '../date-range';

@ValidatorConstraint({ name: 'isNotBeforeFrom', async: false })
class IsNotBeforeFrom implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const from = (args.object as { from?: unknown }).from;
    if (typeof value !== 'string' || typeof from !== 'string') return true;
    const start = parseRangeDate(from, false).getTime();
    const end = parseRangeDate(value, true).getTime();
    return Number.isNaN(start) || Number.isNaN(end) || end >= start;
  }

  defaultMessage(): string {
    return 'End date must not be before the start date';
  }
}

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Query for `GET /api/admin/bookings` (ACC-17). */
export class ListBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['flight', 'hotel'] })
  @IsOptional()
  @IsIn(['flight', 'hotel'])
  type?: 'flight' | 'hotel';

  @ApiPropertyOptional({
    example: 'Confirmed',
    description:
      'Booking status: Pending Payment, Confirmed, Completed, Expired or Cancelled',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  status?: string;

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
