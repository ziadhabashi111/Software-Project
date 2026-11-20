import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trim } from '../../itineraries/dto/transforms';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';

/** Body for `POST /api/hotels/:id/rooms` (HTL-03). */
export class CreateRoomDto {
  @ApiProperty({
    example: '101',
    description: 'Room number or name, unique within the hotel',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name!: string;

  @ApiPropertyOptional({ example: 'Double', maxLength: 40 })
  @IsOptionalNonNull()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  type?: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  beds!: number;

  @ApiProperty({ example: 3, minimum: 1, description: 'At least 1' })
  @IsInt()
  @Min(1)
  @Max(20)
  maxOccupancy!: number;

  @ApiProperty({
    example: 120,
    description: 'Per night, in the platform currency (above 0)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(100000)
  pricePerNight!: number;
}

/**
 * Body for `PATCH /api/hotels/:id/rooms/:roomId` (HTL-05): beds, occupancy,
 * price and type. The room number or name stays, it identifies the room.
 */
export class UpdateRoomDto extends PartialType(
  OmitType(CreateRoomDto, ['name'] as const),
  { skipNullProperties: false },
) {}
