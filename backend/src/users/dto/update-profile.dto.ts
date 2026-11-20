import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const upperCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Only these three fields can be edited here (ACC-09). */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Ziad Habashi',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptionalNonNull()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({
    example: '+20 100 123 4567',
    description:
      'Optional "+", then 7 to 20 digits, spaces, dashes or brackets. null clears it.',
    nullable: true,
  })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9][0-9\s()-]{6,19}$/, {
    message: 'Phone number is not valid',
  })
  phone?: string | null;

  @ApiPropertyOptional({
    example: 'EGP',
    description:
      'ISO 4217 code; stored upper-case and checked against the supported currencies',
  })
  @IsOptionalNonNull()
  @Transform(upperCase)
  @Matches(/^[A-Z]{3}$/, {
    message: 'Currency must be a 3-letter code such as EGP',
  })
  preferredCurrency?: string;
}
