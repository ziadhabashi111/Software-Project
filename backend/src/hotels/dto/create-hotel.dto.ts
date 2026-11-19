import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CITY_ID,
  COUNTRY_CODE,
  lower,
  trim,
  upper,
} from '../../itineraries/dto/transforms';

export const MAX_AMENITIES = 30;

const trimEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item: unknown) =>
        typeof item === 'string' ? item.trim() : item,
      )
    : value;

/** Body for `POST /api/hotels` (HTL-01). */
export class CreateHotelDto {
  @ApiProperty({ example: 'Nile View Hotel', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: '12 Corniche El Nil', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  address!: string;

  @ApiProperty({ example: 'cairo', description: 'City id from the city list' })
  @Transform(lower)
  @Matches(CITY_ID, { message: 'Use a city id such as cairo' })
  city!: string;

  @ApiProperty({ example: 'EG', description: 'Country code' })
  @Transform(upper)
  @Matches(COUNTRY_CODE, {
    message: 'Use a two-letter country code such as EG',
  })
  country!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  starClass!: number;

  @ApiPropertyOptional({
    example: ['wifi', 'pool', 'breakfast'],
    description: `Up to ${MAX_AMENITIES}, each up to 40 characters`,
  })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(MAX_AMENITIES)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  amenities?: string[];
}
