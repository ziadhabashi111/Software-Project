import { Injectable } from '@nestjs/common';
import { Paginated } from '../common/pagination/pagination';
import { UsersService } from '../users/users.service';
import { BookingSources } from './booking-sources';
import type { AdminBookingRecord } from './booking-sources';
import { parseRangeDate } from './date-range';
import { ListBookingsQueryDto } from './dto/list-bookings.dto';

export type AdminBookingRow = Omit<AdminBookingRecord, 'userId'> & {
  user: { id: string; name?: string; email?: string };
};

/** ACC-17: read-only list of every flight and hotel booking. */
@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly sources: BookingSources,
    private readonly users: UsersService,
  ) {}

  async list(query: ListBookingsQueryDto): Promise<Paginated<AdminBookingRow>> {
    const result = await this.sources.list(
      {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from ? { from: parseRangeDate(query.from, false) } : {}),
        ...(query.to ? { to: parseRangeDate(query.to, true) } : {}),
      },
      query,
    );

    const owners = await this.users.findByIds([
      ...new Set(result.items.map((booking) => booking.userId)),
    ]);
    const byId = new Map(owners.map((owner) => [owner.id, owner]));

    return {
      ...result,
      items: result.items.map(({ userId, ...booking }) => {
        const owner = byId.get(userId);
        return {
          ...booking,
          user: owner
            ? { id: userId, name: owner.name, email: owner.email }
            : { id: userId },
        };
      }),
    };
  }
}
