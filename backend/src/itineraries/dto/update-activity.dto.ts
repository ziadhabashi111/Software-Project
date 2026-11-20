import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';
import { CURRENCY_CODE, TIME_OF_DAY, trim, upper } from './transforms';

/**
 * Body for `PATCH /api/activities/:id` (ITN-10). Send `null` to clear the
 * description, time, cost or currency. A cost always has a currency: a new
 * cost keeps the activity's stored currency unless one is sent, and the
 * currency cannot be cleared while a cost remains (checked by the service,
 * which sees the stored activity).
 */
export class UpdateActivityDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptionalNonNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ example: '09:30', nullable: true })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'Use a time as HH:mm, for example 09:30' })
  time?: string | null;

  @ApiPropertyOptional({ minimum: 0, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  cost?: number | null;

  @ApiPropertyOptional({
    example: 'USD',
    nullable: true,
    description:
      'Currency of the cost. Required when setting a cost on an activity that has no currency yet.',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency?: string | null;
}
