import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';

export const BOOKING_GROUPS = ['upcoming', 'past', 'cancelled'] as const;
export type BookingGroup = (typeof BOOKING_GROUPS)[number];

/** FLT-25: my flight bookings, one group per page request. */
export class ListFlightBookingsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BOOKING_GROUPS,
    default: 'upcoming',
    description:
      'upcoming: unpaid holds still running and Confirmed bookings; past: Completed and Expired; cancelled: Cancelled',
  })
  @IsOptional()
  @IsIn(BOOKING_GROUPS)
  group: BookingGroup = 'upcoming';
}
