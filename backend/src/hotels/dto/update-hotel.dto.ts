import { PartialType } from '@nestjs/swagger';
import { CreateHotelDto } from './create-hotel.dto';

/** Body for `PATCH /api/hotels/:id` (HTL-01): send only what changes. */
export class UpdateHotelDto extends PartialType(CreateHotelDto, {
  skipNullProperties: false,
}) {}
