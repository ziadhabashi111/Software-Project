import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';
import { MAX_SEATS_PER_ROW, MIN_SEATS_PER_ROW } from '../seat-layout';

/** Body for `PATCH /api/flights/:id/cabins/:cabinId` (FLT-04, FLT-05). */
export class UpdateCabinDto {
  @ApiPropertyOptional({
    example: 160,
    description: 'Cannot go below the seats already booked or held',
  })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(1000)
  seats?: number;

  @ApiPropertyOptional({
    example: 450,
    description: 'Does not change existing bookings',
  })
  @IsOptionalNonNull()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1000000)
  price?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(10)
  freeBags?: number;

  @ApiPropertyOptional({ example: 23 })
  @IsOptionalNonNull()
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive()
  @Max(100)
  maxBagWeightKg?: number;

  @ApiPropertyOptional({
    example: 6,
    description:
      'Seats per row for the seat map (FLT-28), 2 to 10. Default: 6 in Economy and Premium Economy, 4 in Business and First.',
  })
  @IsOptionalNonNull()
  @IsInt()
  @Min(MIN_SEATS_PER_ROW)
  @Max(MAX_SEATS_PER_ROW)
  seatsPerRow?: number;
}
