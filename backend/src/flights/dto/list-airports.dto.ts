import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { trim } from '../../itineraries/dto/transforms';

/** Query for `GET /api/airports` (FLT-02). */
export class ListAirportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches the IATA code, airport name or city id',
    example: 'cairo',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}
