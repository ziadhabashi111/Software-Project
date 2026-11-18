import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNumber,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CITY_ID, CURRENCY_CODE, lower, upper } from '../../dto/transforms';
import { TransportMode } from '../budget-categories';

/** Body for `POST /api/itineraries/:id/transport-costs` (ITN-16). */
export class CreateTransportCostDto {
  @ApiProperty({ description: 'Day of the itinerary the trip belongs to' })
  @IsMongoId()
  dayId!: string;

  @ApiProperty({ enum: TransportMode, example: TransportMode.TRAIN })
  @IsEnum(TransportMode, {
    message: 'Mode must be flight, train, bus, car, ferry or other',
  })
  mode!: TransportMode;

  @ApiProperty({ example: 'cairo', description: 'City id from the city list' })
  @Transform(lower)
  @Matches(CITY_ID, { message: 'Use a city id such as cairo' })
  fromCity!: string;

  @ApiProperty({ example: 'luxor', description: 'City id from the city list' })
  @Transform(lower)
  @Matches(CITY_ID, { message: 'Use a city id such as luxor' })
  toCity!: string;

  @ApiProperty({ minimum: 0, example: 35 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  amount!: number;

  @ApiProperty({ example: 'USD', description: 'Three-letter currency code' })
  @Transform(upper)
  @Matches(CURRENCY_CODE, {
    message: 'Use a three-letter currency code such as USD',
  })
  currency!: string;
}
