import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { DATE_ONLY } from '../../itineraries/dto/transforms';

/** Query for `GET /api/hotels/:id/availability` (HTL-08). */
export class AvailabilityQueryDto {
  @ApiProperty({ example: '2027-03-01', description: 'First day, YYYY-MM-DD' })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  from!: string;

  @ApiProperty({
    example: '2027-03-14',
    description:
      'Last day (included), YYYY-MM-DD; at most 62 days after the first',
  })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  to!: string;
}
