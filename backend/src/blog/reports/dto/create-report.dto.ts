import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { ContentType } from '../../../admin/content-moderators';
import { REPORT_REASON_MAX } from '../report.schema';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Body for `POST /api/reports` (GEN-09). */
export class CreateReportDto {
  @ApiProperty({
    enum: ContentType,
    example: ContentType.POST,
    description: 'What is being reported',
  })
  @IsEnum(ContentType, {
    message: 'contentType must be post, comment, review or itinerary',
  })
  contentType!: ContentType;

  @ApiProperty({
    example: '6650f1c2a1b2c3d4e5f60789',
    description: 'Id of the post, comment, review or itinerary',
  })
  @IsMongoId({ message: 'contentId must be a valid id' })
  contentId!: string;

  @ApiProperty({
    example: 'Spam: the post only advertises a website',
    maxLength: REPORT_REASON_MAX,
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason for the report' })
  @MaxLength(REPORT_REASON_MAX, {
    message: `The reason can be at most ${REPORT_REASON_MAX} characters`,
  })
  reason!: string;
}
