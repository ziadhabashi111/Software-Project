import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { LinkedBookingType } from '../booking-links';

/** Body of `POST /api/itineraries/:id/bookings` (ITN-27). */
export class LinkBookingDto {
  @ApiProperty({
    enum: LinkedBookingType,
    example: LinkedBookingType.HOTEL,
    description: 'A flight booking or a hotel reservation',
  })
  @IsEnum(LinkedBookingType)
  bookingType!: LinkedBookingType;

  @ApiProperty({
    example: '6660a1b2c3d4e5f601234567',
    description: 'Id of one of your own confirmed bookings',
  })
  @IsMongoId()
  bookingId!: string;

  @ApiProperty({
    example: '6660a1b2c3d4e5f601234568',
    description: 'A day of this itinerary',
  })
  @IsMongoId()
  dayId!: string;
}
