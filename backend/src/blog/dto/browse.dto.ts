import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
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

/**
 * Query for `GET /api/authors/:id` (BLG-12): `page`/`limit` page through the
 * posts, `itinerariesPage` through the public itineraries (10 per page).
 */
export class AuthorPageQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Page of public itineraries (10 per page)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage = 1;
}
