import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CITY_ID, CURRENCY_CODE, lower, upper } from '../../dto/transforms';
import { TransportMode } from '../budget-categories';

/** Body for `PATCH /api/transport-costs/:id` (ITN-16). Send only what changes. */
export class UpdateTransportCostDto {
  @ApiPropertyOptional({
    description: 'Move the entry to another day of the same itinerary',
  })
  @IsOptional()
  @IsMongoId()
  dayId?: string;

  @ApiPropertyOptional({ enum: TransportMode })
  @IsOptional()
  @IsEnum(TransportMode, {
    message: 'Mode must be flight, train, bus, car, ferry or other',
  })
  mode?: TransportMode;

  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @Transform(lower)
  @Matches(CITY_ID, { message: 'Use a city id such as cairo' })
  fromCity?: string;

  @ApiPropertyOptional({ example: 'luxor' })
  @IsOptional()
  @Transform(lower)
  @Matches(CITY_ID, { message: 'Use a city id such as luxor' })
  toCity?: string;

  @ApiPropertyOptional({ minimum: 0, example: 40 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency?: string;
}
