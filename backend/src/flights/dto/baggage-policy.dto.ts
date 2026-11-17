import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';

/** Body for `PUT /api/airlines/:id/baggage-policy` (FLT-08). */
export class BaggagePolicyDto {
  @ApiProperty({
    example: 25,
    description: 'Price per extra bag, in the platform currency (> 0)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100000)
  extraBagPrice!: number;

  @ApiProperty({
    example: 2,
    description: 'Most extra bags one passenger can add (>= 0)',
  })
  @IsInt()
  @Min(0)
  @Max(50)
  maxExtraBags!: number;
}
