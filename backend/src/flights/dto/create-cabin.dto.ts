import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';
import { CabinClass } from '../flight-status';

/** Body for `POST /api/flights/:id/cabins` (FLT-04). */
export class CreateCabinDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass, {
    message: 'Cabin must be Economy, Premium Economy, Business or First',
  })
  cabinClass!: CabinClass;

  @ApiProperty({ example: 150, description: 'Whole number of seats, above 0' })
  @IsInt()
  @Min(1)
  @Max(1000)
  seats!: number;

  @ApiProperty({
    example: 420,
    description: 'Fare in the platform currency, above 0',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1000000)
  price!: number;

  @ApiProperty({
    example: 1,
    description: 'Free bags per passenger (0 or more)',
  })
  @IsInt()
  @Min(0)
  @Max(10)
  freeBags!: number;

  @ApiProperty({
    example: 23,
    description: 'Maximum weight per bag in kg, above 0',
  })
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive()
  @Max(100)
  maxBagWeightKg!: number;
}
