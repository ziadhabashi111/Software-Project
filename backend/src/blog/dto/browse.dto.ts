import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { TAG_MAX_LENGTH } from './post.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Query for `GET /api/posts` (BLG-02). */
export class BrowsePostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Only posts with this tag',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(TAG_MAX_LENGTH)
  tag?: string;
}

/** Query for `GET /api/posts/search` (BLG-09). */
export class SearchPostsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 'pyramids',
    description: 'Keyword matched in the title, the tags or the author name',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter a keyword to search for' })
  @MaxLength(100)
  q!: string;
}

/** Query for `GET /api/authors/:id` (BLG-12): pages through the posts. */
export class AuthorPageQueryDto extends PaginationQueryDto {}
