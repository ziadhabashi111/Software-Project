import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsISO8601,
  IsMongoId,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Most rooms one reservation may hold, to keep a single request bounded. */
export const MAX_ROOMS_PER_RESERVATION = 20;

export class RoomGuestsDto {
  @ApiProperty({ example: '665f1c2a9b1e8a0012345678', description: 'Room id' })
  @IsMongoId()
  roomId!: string;

  @ApiProperty({ minimum: 0, maximum: 20, example: 2 })
  @IsInt()
  @Min(0)
  @Max(20)
  adults!: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [7],
    description: 'Age of each child in this room (0-17)',
    default: [],
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true, message: 'Children are aged 0-17' })
  childrenAges: number[] = [];
}

/** Body for `POST /api/hotel-bookings` (HTL-16, HTL-18). */
export class CreateHotelBookingDto {
  @ApiProperty({ example: '665f1c2a9b1e8a0012345670' })
  @IsMongoId()
  hotelId!: string;

  @ApiProperty({ example: '2027-03-01', description: 'YYYY-MM-DD' })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  checkIn!: string;

  @ApiProperty({
    example: '2027-03-04',
    description: 'YYYY-MM-DD, after check-in',
  })
  @Matches(DATE_ONLY, { message: 'Use a date as YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  checkOut!: string;

  @ApiProperty({
    type: [RoomGuestsDto],
    description:
      'One entry per room, each room at most once, all from the same hotel',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_RESERVATION)
  @ArrayUnique((room: RoomGuestsDto) => room.roomId, {
    message: 'Each room can be selected only once',
  })
  @ValidateNested({ each: true })
  @Type(() => RoomGuestsDto)
  rooms!: RoomGuestsDto[];
}
