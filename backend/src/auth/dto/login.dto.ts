import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizeEmail } from './transforms';

export class LoginDto {
  @ApiProperty({ example: 'ziad@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Passw0rdOk' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
