import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { CITY_ID, COUNTRY_CODE, lower, trim, upper } from './transforms';

/** Query for `GET /api/itineraries/public/search` (ITN-21). */
export class PublicSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'egypt',
    description:
      'Keyword: found in the title, or in the name or code of a country or city of the itinerary',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ example: 'EG', description: 'Country code' })
  @IsOptional()
  @Transform(upper)
  @Matches(COUNTRY_CODE, {
    message: 'Use a two-letter country code such as EG',
  })
  country?: string;

  @ApiPropertyOptional({ example: 'cairo', description: 'City id' })
  @IsOptional()
  @Transform(lower)
  @Matches(CITY_ID, { message: 'Use a city id such as cairo' })
  city?: string;

  @ApiPropertyOptional({ example: 3, description: 'Fewest days, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  minDays?: number;

  @ApiPropertyOptional({ example: 10, description: 'Most days, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  maxDays?: number;
}
