import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsOptionalNonNull } from '../../../common/validation/is-optional-non-null';
import { CURRENCY_CODE, trim, upper } from '../../dto/transforms';
import { BudgetCategory } from '../budget-categories';

/** Body for `PATCH /api/budgets/:id` (ITN-14). Send only what changes. */
export class UpdateBudgetEntryDto {
  @ApiPropertyOptional({ enum: BudgetCategory })
  @IsOptionalNonNull()
  @IsEnum(BudgetCategory, {
    message:
      'Category must be food, accommodation, in_city_transport or activities',
  })
  category?: BudgetCategory;

  @ApiPropertyOptional({ minimum: 0, example: 45 })
  @IsOptionalNonNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  amount?: number;

  @ApiPropertyOptional({ example: 'EUR' })
  @IsOptionalNonNull()
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptionalNonNull()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}
