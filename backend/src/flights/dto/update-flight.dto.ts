import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import { upper } from '../../itineraries/dto/transforms';
import {
  IATA_CODE,
  LOCAL_TIME_MESSAGE,
  LOCAL_TIME_PATTERN,
} from './create-flight.dto';

/** Body for `PATCH /api/flights/:id` (FLT-05). Send only what changes. */
export class UpdateFlightDto {
  @ApiPropertyOptional({
    example: 'CAI',
    description:
      'Only until the flight has any booking or hold. Send departureTime too: the local time at the new airport.',
  })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(IATA_CODE, { message: 'Use a 3-letter IATA airport code' })
  departureAirport?: string;

  @ApiPropertyOptional({
    example: 'JFK',
    description:
      'Only until the flight has any booking or hold. Send arrivalTime too: the local time at the new airport.',
  })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(IATA_CODE, { message: 'Use a 3-letter IATA airport code' })
  arrivalAirport?: string;

  @ApiPropertyOptional({ example: '2027-03-01T15:00' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN, { message: LOCAL_TIME_MESSAGE })
  departureTime?: string;

  @ApiPropertyOptional({ example: '2027-03-01T20:15' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_TIME_PATTERN, { message: LOCAL_TIME_MESSAGE })
  arrivalTime?: string;
}
