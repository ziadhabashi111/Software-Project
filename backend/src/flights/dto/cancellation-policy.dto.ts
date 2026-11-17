import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_CANCELLATION_TIERS } from '../airline-policies';

export class CancellationTierDto {
  @ApiProperty({
    example: 7,
    description: 'Whole days before departure (>= 0), unique within the policy',
  })
  @IsInt()
  @Min(0)
  @Max(3650)
  daysBefore!: number;

  @ApiProperty({ example: 50, description: 'Refund percentage, 0 to 100' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  refundPercent!: number;
}

/** Body for `PUT /api/airlines/:id/cancellation-policy` (FLT-09). */
export class CancellationPolicyDto {
  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'The whole policy; replaces the existing tiers. An empty list means no refund on cancellation.',
    example: [
      { daysBefore: 14, refundPercent: 100 },
      { daysBefore: 3, refundPercent: 50 },
    ],
  })
  @IsArray()
  @ArrayMaxSize(MAX_CANCELLATION_TIERS)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers!: CancellationTierDto[];
}
