import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from '../password.service';

/** Body of `POST /api/auth/reset-password` (ACC-07). */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'The token from the link in the reset email',
    example: 'k3J9x0Qm2pXq7Zr1sT5vB8nC4dF6gH0jL2mN4pQ6rS8',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;

  @ApiProperty({
    example: 'NewPassw0rd',
    description: PASSWORD_RULE_MESSAGE,
    minLength: 8,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(72) // bcrypt only uses the first 72 bytes
  newPassword!: string;
}
