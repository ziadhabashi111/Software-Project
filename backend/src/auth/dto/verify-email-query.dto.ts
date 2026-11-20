import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Query of `GET /api/auth/verify-email` (ACC-02). */
export class VerifyEmailQueryDto {
  @ApiProperty({
    description: 'The token from the link in the verification email',
    example: 'k3J9x0Qm2pXq7Zr1sT5vB8nC4dF6gH0jL2mN4pQ6rS8',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string;
}
