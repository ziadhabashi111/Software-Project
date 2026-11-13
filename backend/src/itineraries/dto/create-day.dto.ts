import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CITY_ID, lower } from './transforms';

/** Body for `POST /api/itineraries/:id/days` (ITN-05, ITN-09). */
export class CreateDayDto {
  @ApiProperty({
    example: 'cairo',
    description: 'City id from the predefined city list. Required.',
  })
  @Transform(lower)
  @IsString()
  @Matches(CITY_ID, { message: 'Choose a city from the city list' })
  city!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
