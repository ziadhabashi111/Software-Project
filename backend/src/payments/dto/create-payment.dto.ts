import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import { BOOKING_TYPES } from '../refund.service.interface';
import type { BookingType } from '../refund.service.interface';

export class CreatePaymentDto {
  @ApiProperty({
    enum: BOOKING_TYPES,
    example: 'flight',
    description:
      '`flight-change` pays the fare difference of a flight change (FLT-27); bookingId is then the change id returned by PATCH /api/flight-bookings/:id/change-flight.',
  })
  @IsIn(BOOKING_TYPES)
  bookingType!: BookingType;

  @ApiProperty({ example: '674a1f0c2b3d4e5f6a7b8c9d' })
  @IsMongoId()
  bookingId!: string;
}
