import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { upper } from '../../itineraries/dto/transforms';

export const FLIGHT_NUMBER = /^[A-Z0-9]{3,8}$/;
export const IATA_CODE = /^[A-Z]{3}$/;
export const LOCAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
export const LOCAL_TIME_MESSAGE =
  'Use the airport’s local time as YYYY-MM-DDTHH:mm, for example 2027-03-01T14:30';

/** Body for `POST /api/flights` (FLT-03). The airline is the moderator's own. */
export class CreateFlightDto {
  @ApiProperty({ example: 'MS985', description: '3 to 8 letters or digits' })
  @Transform(upper)
  @IsString()
  @Matches(FLIGHT_NUMBER, {
    message: 'Flight number must be 3 to 8 letters or digits',
  })
  flightNumber!: string;

  @ApiProperty({
    example: 'CAI',
    description: 'IATA code from GET /api/airports',
  })
  @Transform(upper)
  @IsString()
  @Matches(IATA_CODE, { message: 'Use a 3-letter IATA airport code' })
  departureAirport!: string;

  @ApiProperty({
    example: 'JFK',
    description: 'IATA code from GET /api/airports',
  })
  @Transform(upper)
  @IsString()
  @Matches(IATA_CODE, { message: 'Use a 3-letter IATA airport code' })
  arrivalAirport!: string;

  @ApiProperty({
    example: '2027-03-01T14:30',
    description: 'Local time at the departure airport; stored in UTC',
  })
  @IsString()
  @Matches(LOCAL_TIME_PATTERN, { message: LOCAL_TIME_MESSAGE })
  departureTime!: string;

  @ApiProperty({
    example: '2027-03-01T19:45',
    description: 'Local time at the arrival airport; stored in UTC',
  })
  @IsString()
  @Matches(LOCAL_TIME_PATTERN, { message: LOCAL_TIME_MESSAGE })
  arrivalTime!: string;
}
