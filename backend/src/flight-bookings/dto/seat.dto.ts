import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';
import { CabinClass } from '../../flights/flight-status';

/** Body for `PATCH /api/flight-bookings/:id/seat` (FLT-28). */
export class PickSeatDto {
  @ApiPropertyOptional({
    example: 0,
    default: 0,
    description: '0 for the outbound flight, 1 for the return flight',
  })
  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(1)
  segmentIndex?: number;

  @ApiProperty({
    example: 0,
    description: 'Position of the passenger in the booking (from 0)',
  })
  @IsInt()
  @Min(0)
  @Max(20)
  passengerIndex!: number;

  @ApiProperty({ example: '12C', description: 'Row number and seat letter' })
  @IsString()
  @Length(2, 5)
  seat!: string;
}

/** Query for `GET /api/flights/:id/seats` (FLT-28). */
export class SeatMapQueryDto {
  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @Type(() => String)
  @IsEnum(CabinClass, {
    message: 'Cabin must be Economy, Premium Economy, Business or First',
  })
  cabinClass!: CabinClass;
}
