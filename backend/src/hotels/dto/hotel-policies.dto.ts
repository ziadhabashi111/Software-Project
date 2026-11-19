import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CancellationTierDto } from '../../flights/dto/cancellation-policy.dto';
import { MAX_CANCELLATION_TIERS } from '../../flights/airline-policies';
import { TIME_OF_DAY } from '../../itineraries/dto/transforms';

/** Body for `PUT /api/hotels/:id/policies` (HTL-09, HTL-10): send the parts to set. */
export class HotelPoliciesDto {
  @ApiPropertyOptional({
    example: '14:00',
    description: 'Standard check-in time, HH:mm',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'Use a time as HH:mm, for example 14:00' })
  checkInTime?: string;

  @ApiPropertyOptional({
    example: '12:00',
    description: 'Standard check-out time, HH:mm',
  })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'Use a time as HH:mm, for example 12:00' })
  checkOutTime?: string;

  @ApiPropertyOptional({
    type: [CancellationTierDto],
    description:
      'The whole cancellation policy; replaces the existing tiers. Each tier has a unique days-before-check-in threshold (whole number >= 0) and a refund percentage (0 to 100). An empty list means no refund.',
    example: [
      { daysBefore: 14, refundPercent: 100 },
      { daysBefore: 3, refundPercent: 50 },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CANCELLATION_TIERS)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers?: CancellationTierDto[];
}
