import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import { AuditAction } from '../../audit/audit-action';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { IsNotBeforeFrom } from '../date-range';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Query for `GET /api/admin/audit-logs` (GEN-07). */
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'Id of the admin who acted' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({
    example: 'post',
    description:
      'What was acted on: user, hotel, airline, post, comment, review, itinerary, report',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  targetType?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Start of the range. YYYY-MM-DD or a full ISO timestamp.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'End of the range (inclusive). A plain date covers that whole day (UTC).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Validate(IsNotBeforeFrom)
  to?: string;
}
