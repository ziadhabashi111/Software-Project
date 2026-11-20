import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { DATE_ONLY } from '../../itineraries/dto/transforms';

/** Query for `GET /api/hotels/:id/rooms/available` (HTL-15). */
export class AvailableRoomsQueryDto {
  @ApiProperty({
    example: '2027-03-10',
    description: 'First night, YYYY-MM-DD',
  })
  @IsString()
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  checkIn!: string;

  @ApiProperty({
    example: '2027-03-13',
    description: 'Check-out day, YYYY-MM-DD (not a night); after check-in',
  })
  @IsString()
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  checkOut!: string;
}
