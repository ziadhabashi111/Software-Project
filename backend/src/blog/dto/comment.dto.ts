import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';

export const COMMENT_MAX = 500;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Body for `POST /api/posts/:id/comments` and `PATCH /api/comments/:id` (BLG-05, BLG-07). */
export class CommentBodyDto {
  @ApiProperty({ example: 'Great tips, thanks!', maxLength: COMMENT_MAX })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Comment cannot be empty' })
  @MaxLength(COMMENT_MAX, {
    message: `Comment can be at most ${COMMENT_MAX} characters`,
  })
  body!: string;
}

/** Query for `GET /api/posts/:id/comments` (BLG-05). */
export class ListCommentsQueryDto extends PaginationQueryDto {}
