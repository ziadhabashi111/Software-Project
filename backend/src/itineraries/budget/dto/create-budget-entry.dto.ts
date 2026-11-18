import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CURRENCY_CODE, trim, upper } from '../../dto/transforms';
import { BudgetCategory } from '../budget-categories';

/** Body for `POST /api/itineraries/:id/days/:dayId/budgets` (ITN-14). */
export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory, {
    message:
      'Category must be food, accommodation, in_city_transport or activities',
  })
  category!: BudgetCategory;

  @ApiProperty({ minimum: 0, example: 40, description: 'Not negative' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  amount!: number;

  @ApiProperty({ example: 'EUR', description: 'Three-letter currency code' })
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency!: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'Dinner' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}
