import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { normalizeEmail } from './transforms';

/** Body of `POST /api/auth/forgot-password` (ACC-07). */
export class ForgotPasswordDto {
  @ApiProperty({ example: 'ziad@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
