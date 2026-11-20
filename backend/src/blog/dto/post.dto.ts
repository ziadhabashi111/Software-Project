import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { PostStatus } from '../schemas/post.schema';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

export const TITLE_MAX = 150;
export const BODY_MAX = 20_000;
export const TAGS_MAX = 5;
export const TAG_MAX_LENGTH = 30;
export const IMAGES_MAX = 5;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Tags are trimmed, lower-cased and de-duplicated, so `Cairo` = `cairo `. */
export const normalizeTags = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.map((tag: unknown) =>
            typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
          ),
        ),
      ]
    : value;

/** Body for `POST /api/posts` (BLG-01, BLG-08). */
export class CreatePostDto {
  @ApiProperty({ example: 'Three days in Cairo', maxLength: TITLE_MAX })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(TITLE_MAX, {
    message: `Title can be at most ${TITLE_MAX} characters`,
  })
  title!: string;

  @ApiProperty({
    example: 'Day 1: the pyramids at sunrise...',
    maxLength: BODY_MAX,
  })
  @IsString()
  @Matches(/\S/, { message: 'Body is required' })
  @MaxLength(BODY_MAX, {
    message: `Body can be at most ${BODY_MAX} characters`,
  })
  body!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['cairo', 'food'],
    description: `Up to ${TAGS_MAX} tags of at most ${TAG_MAX_LENGTH} characters; stored lower-case`,
  })
  @IsOptionalNonNull()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(TAGS_MAX, { message: `At most ${TAGS_MAX} tags` })
  @IsString({ each: true })
  @Matches(/\S/, { each: true, message: 'A tag cannot be empty' })
  @MaxLength(TAG_MAX_LENGTH, {
    each: true,
    message: `Each tag can be at most ${TAG_MAX_LENGTH} characters`,
  })
  tags?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: `Up to ${IMAGES_MAX} image URLs returned by POST /api/uploads/images (GEN-08). Images can also be added later with POST /api/posts/:id/images.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(IMAGES_MAX, { message: `At most ${IMAGES_MAX} images` })
  @ArrayUnique({ message: 'Each image can be added only once' })
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { each: true, message: 'Each image must be a URL from the upload helper' },
  )
  imageUrls?: string[];

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.DRAFT,
    description: 'draft (only you see it) or published',
  })
  @IsOptionalNonNull()
  @IsEnum(PostStatus, { message: 'status must be draft or published' })
  status?: PostStatus;
}

/**
 * Body for `PATCH /api/posts/:id` (BLG-04, BLG-08). No `imageUrls`: images
 * change only through the image endpoints, and the global ValidationPipe
 * (forbidNonWhitelisted) rejects the field with a 400.
 */
export class UpdatePostDto extends PartialType(
  OmitType(CreatePostDto, ['imageUrls'] as const),
  { skipNullProperties: false },
) {}

/** Query for `GET /api/posts/mine` (BLG-03). */
export class ListMyPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PostStatus })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}

/** Query for `GET /api/tags/:tag/posts` (BLG-08). */
export class ListTagPostsQueryDto extends PaginationQueryDto {}

/** Body of `PATCH /api/posts/:id/itinerary` (BLG-13). */
export class SetPostItineraryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '6660a1b2c3d4e5f601234567',
    description:
      'Id of one of your own public itineraries, or null to remove the link',
  })
  @ValidateIf((_, value) => value !== null)
  @IsMongoId({ message: 'Use an itinerary id, or null to remove the link' })
  itineraryId!: string | null;
}
