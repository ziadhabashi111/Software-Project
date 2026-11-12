import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from '../password.service';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Passw0rdOk' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({
    example: 'NewPassw0rd',
    description: PASSWORD_RULE_MESSAGE,
    minLength: 8,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(72)
  newPassword!: string;
}
