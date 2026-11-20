import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { MAX_DAYS } from '../itinerary-limits';

/** Query for `GET /api/itineraries/:id/hotels` (ITN-25). */
export class ItineraryHotelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    description:
      'Which city group to find hotels for, counted from 1 in the order of the itinerary’s groups',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  group = 1;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  guests = 1;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rooms = 1;
}
