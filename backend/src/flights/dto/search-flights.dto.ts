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
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { DATE_ONLY, upper } from '../../itineraries/dto/transforms';
import { CabinClass } from '../flight-status';
import { IATA_CODE } from './create-flight.dto';

export enum FlightSortBy {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE = 'departure',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** Query for `GET /api/flights/search` (FLT-11, FLT-12, FLT-15). */
export class SearchFlightsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 'CAI', description: 'Departure airport (IATA)' })
  @Transform(upper)
  @IsString()
  @Matches(IATA_CODE, { message: 'Use a 3-letter IATA airport code' })
  from!: string;

  @ApiProperty({ example: 'JFK', description: 'Arrival airport (IATA)' })
  @Transform(upper)
  @IsString()
  @Matches(IATA_CODE, { message: 'Use a 3-letter IATA airport code' })
  to!: string;

  @ApiProperty({
    example: '2027-03-01',
    description: 'Departure date: the local date at the departure airport',
  })
  @IsString()
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  date!: string;

  @ApiPropertyOptional({
    example: '2027-03-10',
    description:
      'Makes it a round trip: also returns flights from the arrival to the departure airport on this local date',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  returnDate?: string;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: 9,
    description: 'Adults (12+)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  adults = 1;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: 9,
    description: 'Children (2-11)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9)
  children = 0;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: 9,
    description: 'Infants (under 2): no seat, at most one per adult',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9)
  infants = 0;

  @ApiPropertyOptional({ enum: CabinClass })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional({ example: 100, description: 'Inclusive minimum fare' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 800, description: 'Inclusive maximum fare' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: FlightSortBy, default: FlightSortBy.DEPARTURE })
  @IsOptional()
  @IsEnum(FlightSortBy)
  sortBy: FlightSortBy = FlightSortBy.DEPARTURE;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.ASC;
}
