import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReportAction } from '../report-source';

/** Body for `PATCH /api/admin/reports/:id` (GEN-10). */
export class ResolveReportDto {
  @ApiProperty({
    enum: ReportAction,
    description:
      'dismiss: the report is unfounded. hide: hide the content (author and admins still see it). delete: remove the content.',
  })
  @IsEnum(ReportAction)
  action!: ReportAction;
}
