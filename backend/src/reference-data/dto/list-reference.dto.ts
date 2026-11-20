import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { COUNTRY_CODE, trim, upper } from '../../itineraries/dto/transforms';

/** Query for `GET /api/countries` (GEN-12). */
export class ListCountriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches the country code or name',
    example: 'egy',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

/** Query for `GET /api/cities` (GEN-12). */
export class ListCitiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Only cities of this country (code from GET /api/countries)',
    example: 'EG',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(COUNTRY_CODE, {
    message: 'countryCode must be a two-letter country code such as EG',
  })
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'Matches the city id or name',
    example: 'cai',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  search?: string;
}

/** Query for `GET /api/currencies` (GEN-12). */
export class ListCurrenciesQueryDto extends PaginationQueryDto {}
