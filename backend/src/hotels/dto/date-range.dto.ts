import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  Matches,
  ValidateNested,
} from 'class-validator';
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

/**
 * Body for `PATCH /api/hotels/:id/rooms/:roomId/availability` (HTL-05): the
 * room's complete set of bookable ranges, replacing the current one.
 */
export class ReplaceAvailabilityDto {
  @ApiProperty({
    type: [DateRangeDto],
    description:
      'Every bookable range of the room; ranges must not overlap. An empty list removes all availability.',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DateRangeDto)
  ranges!: DateRangeDto[];
}
