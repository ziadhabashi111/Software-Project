import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import {
  PASSWORD_REGEX,
  PASSWORD_RULE_MESSAGE,
} from '../../auth/password.service';

/** Body for `POST /api/admin/users/:id/reset-password` (ACC-07a). */
export class AdminResetPasswordDto {
  @ApiProperty({
    example: 'Temp0rary1',
    description: `The temporary password the admin hands over. ${PASSWORD_RULE_MESSAGE}`,
    minLength: 8,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(72) // bcrypt only uses the first 72 bytes
  temporaryPassword!: string;
}
