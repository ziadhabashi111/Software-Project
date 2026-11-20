import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SortOrder } from '../../flights/dto/search-flights.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import {
  CITY_ID,
  COUNTRY_CODE,
  DATE_ONLY,
  lower,
  upper,
} from '../../itineraries/dto/transforms';
import { HotelSortBy } from '../search/hotel-search-rules';

/** Most guests and rooms one search can ask for. */
export const MAX_SEARCH_GUESTS = 40;
export const MAX_SEARCH_ROOMS = 9;

/** Query for `GET /api/hotels/search` (HTL-11, HTL-12). */
export class SearchHotelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'City id from GET /api/cities. Send this or `country`.',
  })
  @IsOptional()
  @Transform(lower)
  @IsString()
  @Matches(CITY_ID, { message: 'Use a city id such as cairo' })
  city?: string;

  @ApiPropertyOptional({
    example: 'EG',
    description: 'Country code from GET /api/countries. Send this or `city`.',
  })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(COUNTRY_CODE, { message: 'Use a 2-letter country code such as EG' })
  country?: string;

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

  @ApiProperty({ example: 2, minimum: 1, maximum: MAX_SEARCH_GUESTS })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_GUESTS)
  guests!: number;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: MAX_SEARCH_ROOMS,
    description: 'Rooms wanted; every room needs at least one guest',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_ROOMS)
  rooms = 1;

  @ApiPropertyOptional({
    example: 50,
    description:
      'Inclusive minimum price per night (of the cheapest free room)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    example: 200,
    description:
      'Inclusive maximum price per night (of the cheapest free room)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description:
      'Minimum average rating; hotels with no ratings are left out when this is set',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: HotelSortBy, default: HotelSortBy.PRICE })
  @IsOptional()
  @IsEnum(HotelSortBy)
  sortBy: HotelSortBy = HotelSortBy.PRICE;

  @ApiPropertyOptional({
    enum: SortOrder,
    default: SortOrder.ASC,
    description: 'Use `desc` with `sortBy=rating` for the best rated first',
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.ASC;
}
