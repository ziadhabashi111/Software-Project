import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ModerationMode {
  HIDE = 'hide',
  DELETE = 'delete',
}

/** Query for `DELETE /api/admin/content/:type/:id` (GEN-10). */
export class ModerateContentQueryDto {
  @ApiPropertyOptional({
    enum: ModerationMode,
    default: ModerationMode.HIDE,
    description:
      'hide (default) keeps the content for its author and admins; delete removes it.',
  })
  @IsOptional()
  @IsEnum(ModerationMode)
  mode: ModerationMode = ModerationMode.HIDE;
}
