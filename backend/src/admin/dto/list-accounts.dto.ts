import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '../../auth/auth.types';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { UserStatus } from '../../users/user-status';

/** Query for `GET /api/admin/accounts` (ACC-14). */
export class ListAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Part of the name or email (case-insensitive)',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
