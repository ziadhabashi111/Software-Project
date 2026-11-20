import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { IsOptionalNonNull } from '../../common/validation/is-optional-non-null';
import { Visibility } from '../schemas/itinerary.schema';
import { CreateItineraryDto } from './create-itinerary.dto';

/**
 * Body for `PATCH /api/itineraries/:id` (ITN-01, ITN-20). Every field is
 * optional, but none can be cleared: `skipNullProperties: false` makes the
 * create rules run on a `null`, so it is a field error (GEN-13).
 */
export class UpdateItineraryDto extends PartialType(CreateItineraryDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    enum: Visibility,
    description:
      'Public itineraries appear in shared search and are read-only to others. Private removes it immediately.',
  })
  @IsOptionalNonNull()
  @IsEnum(Visibility)
  visibility?: Visibility;
}
