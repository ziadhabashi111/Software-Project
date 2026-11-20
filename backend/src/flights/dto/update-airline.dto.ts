import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { trim, upper } from '../../itineraries/dto/transforms';
import { AIRLINE_CODE } from './create-airline.dto';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

/** Body for `PATCH /api/airlines/:id` (FLT-01). Send only the fields to change. */
export class UpdateAirlineDto {
  @ApiPropertyOptional({ example: 'EgyptAir', minLength: 2, maxLength: 100 })
  @IsOptionalNonNull()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ example: 'MS' })
  @IsOptionalNonNull()
  @Transform(upper)
  @IsString()
  @Matches(AIRLINE_CODE, { message: 'Code must be 2 to 3 letters or digits' })
  code?: string;

  @ApiPropertyOptional({
    description:
      'URL returned by the image upload helper (one logo per airline, JPG or PNG up to 5 MB)',
  })
  @IsOptional()
  @Transform(trim)
  @IsUrl({ require_tld: false, require_protocol: false })
  @MaxLength(500)
  logoUrl?: string;
}
