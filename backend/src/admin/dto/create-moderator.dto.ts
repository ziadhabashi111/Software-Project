import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Role } from '../../auth/auth.types';
import { normalizeEmail } from '../../auth/dto/transforms';
import {
  PASSWORD_REGEX,
  PASSWORD_RULE_MESSAGE,
} from '../../auth/password.service';

export const MODERATOR_ROLES = [
  Role.AIRLINE_MODERATOR,
  Role.HOTEL_MODERATOR,
] as const;

/** Body for `POST /api/admin/moderators` (ACC-13). */
export class CreateModeratorDto {
  @ApiProperty({ example: 'Sara Hotel Manager', minLength: 2, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: 'sara@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: MODERATOR_ROLES })
  @IsIn(MODERATOR_ROLES, {
    message: 'Role must be airline_moderator or hotel_moderator',
  })
  role!: (typeof MODERATOR_ROLES)[number];

  @ApiProperty({
    description:
      'Id of the one airline (airline_moderator) or hotel (hotel_moderator) this moderator manages',
  })
  @IsMongoId()
  providerId!: string;

  @ApiProperty({
    example: 'Temp0rary1',
    description: `Set by the admin; the moderator must change it at first login. ${PASSWORD_RULE_MESSAGE}`,
    minLength: 8,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(72)
  temporaryPassword!: string;
}
