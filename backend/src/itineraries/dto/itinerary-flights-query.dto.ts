import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { SearchFlightsQueryDto } from '../../flights/dto/search-flights.dto';
import { DATE_ONLY } from './transforms';

/**
 * Query for `GET /api/itineraries/:id/flights` (ITN-26). The destination is
 * the city of the itinerary's first day, so there is no `to`.
 */
export class ItineraryFlightsQueryDto extends OmitType(SearchFlightsQueryDto, [
  'to',
  'date',
  'returnDate',
] as const) {
  @ApiPropertyOptional({
    example: '2027-03-01',
    description: 'Outbound date. Defaults to the itinerary start date.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Also search the way back (round trip)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === true || value === 'true'
      ? true
      : value === 'false'
        ? false
        : value,
  )
  @IsBoolean()
  roundTrip?: boolean;

  @ApiPropertyOptional({
    example: '2027-03-10',
    description:
      'Return date for a round trip. Defaults to the date of the last day.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  returnDate?: string;
}
