import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { DATE_ONLY } from '../../itineraries/dto/transforms';

/** A run of calendar days, both ends included (HTL-04, HTL-06). */
export class DateRangeDto {
  @ApiProperty({ example: '2027-03-01', description: 'First day, YYYY-MM-DD' })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  from!: string;

  @ApiProperty({
    example: '2027-03-31',
    description: 'Last day (included), YYYY-MM-DD',
  })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  to!: string;
}
