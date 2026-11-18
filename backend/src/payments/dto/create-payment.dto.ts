import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import type { BookingType } from '../refund.service.interface';

export class CreatePaymentDto {
  @ApiProperty({ enum: ['flight', 'hotel'], example: 'flight' })
  @IsIn(['flight', 'hotel'])
  bookingType!: BookingType;

  @ApiProperty({ example: '674a1f0c2b3d4e5f6a7b8c9d' })
  @IsMongoId()
  bookingId!: string;
}
