import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { COUNTRY_CODE, DATE_ONLY, trim, upperEach } from './transforms';

/** Body for `POST /api/itineraries` (ITN-01). It is always created private. */
export class CreateItineraryDto {
  @ApiProperty({ maxLength: 100, example: 'Egypt and Dubai' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @ApiProperty({
    type: [String],
    example: ['EG', 'AE'],
    description: 'One or more country codes from the predefined list',
  })
  @Transform(upperEach)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @Matches(COUNTRY_CODE, {
    each: true,
    message: 'Each country must be a two-letter country code such as EG',
  })
  countries!: string[];

  @ApiProperty({ example: '2027-03-01', description: 'YYYY-MM-DD' })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  startDate!: string;
}
