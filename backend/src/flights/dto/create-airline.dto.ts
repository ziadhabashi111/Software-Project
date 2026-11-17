import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { trim, upper } from '../../itineraries/dto/transforms';

/** Airline codes are 2 to 3 letters or digits, such as MS, LH or A3. */
export const AIRLINE_CODE = /^[A-Z0-9]{2,3}$/;

/** Body for `POST /api/airlines` (FLT-01). */
export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({
    example: 'MS',
    description: '2 to 3 letters or digits, unique across airlines',
  })
  @Transform(upper)
  @IsString()
  @Matches(AIRLINE_CODE, { message: 'Code must be 2 to 3 letters or digits' })
  code!: string;
}
