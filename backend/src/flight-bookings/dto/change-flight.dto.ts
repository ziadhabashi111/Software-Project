import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsMongoId, IsOptional } from 'class-validator';

/** Body of `PATCH /api/flight-bookings/:id/change-flight` (FLT-27). */
export class ChangeFlightDto {
  @ApiPropertyOptional({
    example: 0,
    enum: [0, 1],
    default: 0,
    description: 'Which flight of the booking to change: 0 outbound, 1 return',
  })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: 'segmentIndex must be 0 (outbound) or 1 (return)' })
  segmentIndex?: number;

  @ApiProperty({
    example: '674a1f0c2b3d4e5f6a7b8c9d',
    description:
      'The new flight: same airline, same departure and arrival airports, with the same cabin',
  })
  @IsMongoId({ message: 'flightId must be a flight id' })
  flightId!: string;
}
