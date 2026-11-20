import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';
import { CITY_ID, lower } from './transforms';

/** Body for `PATCH /api/itineraries/:id/days/:dayId` (ITN-05). */
export class UpdateDayDto {
  @ApiPropertyOptional({ example: 'dubai' })
  @IsOptionalNonNull()
  @Transform(lower)
  @IsString()
  @Matches(CITY_ID, { message: 'Choose a city from the city list' })
  city?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    nullable: true,
    description: 'null clears the notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
