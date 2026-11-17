import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';

export const RESERVATION_GROUPS = ['upcoming', 'past', 'cancelled'] as const;
export type ReservationGroup = (typeof RESERVATION_GROUPS)[number];

/** Query for `GET /api/hotel-bookings` (HTL-20). */
export class ListHotelBookingsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: RESERVATION_GROUPS,
    default: 'upcoming',
    description:
      'upcoming: Confirmed stays not yet over and unpaid holds still running (soonest first). past: Completed stays and expired holds (latest first). cancelled: Cancelled reservations (latest cancellation first).',
  })
  @IsOptional()
  @IsIn(RESERVATION_GROUPS)
  group: ReservationGroup = 'upcoming';
}
