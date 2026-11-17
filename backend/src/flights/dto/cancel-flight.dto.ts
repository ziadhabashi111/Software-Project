import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

/** Body for `POST /api/flights/:id/cancel` (FLT-06): cancelling needs confirmation. */
export class CancelFlightDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true. Cancels the flight and refunds every Confirmed booking in full; this cannot be undone.',
  })
  @Equals(true, {
    message: 'Confirm the cancellation by sending confirm: true',
  })
  confirm!: boolean;
}
