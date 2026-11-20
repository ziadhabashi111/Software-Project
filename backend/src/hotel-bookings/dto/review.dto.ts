import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Body for `POST /api/hotel-bookings/:id/review` (HTL-23). */
export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Lovely view of the Nile and very helpful staff.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  text?: string;
}

/** Body for `PATCH /api/reviews/:id`. Send `text: null` to remove the text. */
export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5, example: 4 })
  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    maxLength: 1000,
    nullable: true,
    example: 'Still lovely, but breakfast was cold.',
  })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  text?: string | null;
}
