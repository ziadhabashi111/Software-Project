import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateIf,
} from 'class-validator';
import { CURRENCY_CODE, TIME_OF_DAY, trim, upper } from './transforms';

/** Body for `POST /api/itineraries/:id/days/:dayId/activities` (ITN-10). */
export class CreateActivityDto {
  @ApiProperty({ maxLength: 100, example: 'Pyramids tour' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: '09:30', description: 'HH:mm' })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'Use a time as HH:mm, for example 09:30' })
  time?: string;

  @ApiPropertyOptional({ minimum: 0, example: 25.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  cost?: number;

  @ApiPropertyOptional({
    example: 'USD',
    description:
      'Currency of the cost, a three-letter code. Required when a cost is given, so the cost converts correctly in the budget (ITN-14, ITN-18).',
  })
  // Required whenever a cost is sent; optional otherwise.
  @ValidateIf(
    (dto: CreateActivityDto) => dto.cost != null || dto.currency != null,
  )
  @IsNotEmpty({ message: 'Give the currency of the cost, such as USD' })
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency?: string;
}
