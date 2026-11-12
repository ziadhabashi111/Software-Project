import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_REGEX, PASSWORD_RULE_MESSAGE } from '../password.service';
import { normalizeEmail } from './transforms';

export class RegisterDto {
  @ApiProperty({ example: 'Ziad Habashi', minLength: 2, maxLength: 100 })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: 'ziad@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Passw0rdOk',
    description: PASSWORD_RULE_MESSAGE,
    minLength: 8,
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_RULE_MESSAGE })
  @MaxLength(72) // bcrypt only uses the first 72 bytes
  password!: string;

  @ApiProperty({
    example: true,
    description: 'Terms and privacy consent. Must be true.',
  })
  @Equals(true, { message: 'You must accept the terms and privacy policy' })
  consent!: boolean;
}
