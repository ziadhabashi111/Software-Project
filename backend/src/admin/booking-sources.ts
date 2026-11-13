import { Injectable } from '@nestjs/common';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';

export type AdminBookingType = 'flight' | 'hotel';

export interface AdminBookingQuery {
  /** Booking status exactly as the booking module stores it (GEN-11). */
  status?: string;
  /** Inclusive range on the booking's start date (departure or check-in). */
  from?: Date;
  to?: Date;
  skip: number;
  limit: number;
}

/** One row of the admin booking list. User names are added by the admin module. */
export interface AdminBookingRecord {
  id: string;
  reference: string;
  type: AdminBookingType;
  userId: string;
  provider: { id: string; name: string };
  /** Departure or check-in. */
  startDate: Date;
  /** Arrival or check-out. */
  endDate?: Date;
  amount: number;
  currency: string;
  status: string;
  createdAt: Date;
}

/**
 * Implemented by the flight and hotel booking modules (ACC-17). Return the
 * matching bookings newest first (`createdAt` descending) plus the total
 * number of matches, honouring `skip` and `limit`.
 */
export interface BookingSource {
  type: AdminBookingType;
  find(
    query: AdminBookingQuery,
  ): Promise<{ items: AdminBookingRecord[]; total: number }>;
}

export interface BookingFilter {
  type?: AdminBookingType;
  status?: string;
  from?: Date;
  to?: Date;
}

/**
 * The admin booking list reads from the flight and hotel booking modules
 * without depending on them. Each registers a source in `onModuleInit`.
 */
@Injectable()
export class BookingSources {
  private readonly sources: BookingSource[] = [];

  register(source: BookingSource): void {
    this.sources.push(source);
  }

  /**
   * Merges the sources into one newest-first page. Every source is asked for
   * its first `skip + limit` rows, which is enough to cut the merged page.
   */
  async list(
    filter: BookingFilter,
    page: { page: number; limit: number },
  ): Promise<Paginated<AdminBookingRecord>> {
    const selected = this.sources.filter(
      (source) => !filter.type || source.type === filter.type,
    );
    const skip = skipFor(page);
    const answers = await Promise.all(
      selected.map((source) =>
        source.find({
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.from ? { from: filter.from } : {}),
          ...(filter.to ? { to: filter.to } : {}),
          skip: 0,
          limit: skip + page.limit,
        }),
      ),
    );
    const merged = answers
      .flatMap((answer) => answer.items)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = answers.reduce((sum, answer) => sum + answer.total, 0);
    return toPage(merged.slice(skip, skip + page.limit), total, page);
  }
}
