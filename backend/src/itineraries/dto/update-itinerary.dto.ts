import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Visibility } from '../schemas/itinerary.schema';
import { CreateItineraryDto } from './create-itinerary.dto';

/** Body for `PATCH /api/itineraries/:id` (ITN-01, ITN-20). Every field is optional. */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  @ApiPropertyOptional({
    enum: Visibility,
    description:
      'Public itineraries appear in shared search and are read-only to others. Private removes it immediately.',
  })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;
}
