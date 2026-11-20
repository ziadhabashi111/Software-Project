import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

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
}
