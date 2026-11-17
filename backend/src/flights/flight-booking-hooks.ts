import { Injectable } from '@nestjs/common';
import type { CabinClass } from './flight-status';

/** One flight booking as an airline moderator sees it (FLT-29). */
export interface FlightBookingRow {
  reference: string;
  passengerNames: string[];
  cabinClass: CabinClass;
  seats: number;
  status: 'Confirmed' | 'Cancelled';
}

/** What flights need from flight bookings (Yahia). */
export interface FlightBookingLink {
  /** Users with a Confirmed booking on the flight (FLT-05, FLT-06 notifications). */
  getConfirmedPassengerUserIds(flightId: string): Promise<string[]>;

  /**
   * FLT-06: every Confirmed booking becomes Cancelled with a 100% refund
   * (through the refund service, PAY-03) and pending holds are released.
   * Must be safe to call again for the same flight (idempotent), so a failed
   * cancellation can be retried.
   */
  cancelBookingsForFlight(flightId: string): Promise<{ cancelled: number }>;

  /**
   * FLT-29: Confirmed and Cancelled bookings of the flight, newest first.
   * Without `page` returns all of them (CSV export).
   */
  listBookings(
    flightId: string,
    page?: { skip: number; limit: number },
  ): Promise<{ items: FlightBookingRow[]; total: number }>;
}

/**
 * Flight bookings register here so this module does not depend on them:
 *
 *   constructor(hooks: FlightBookingHooks) {}
 *   onModuleInit() { this.hooks.register(this); }
 *
 * Until they do, a flight has no bookings.
 */
@Injectable()
export class FlightBookingHooks {
  private link?: FlightBookingLink;

  register(link: FlightBookingLink): void {
    this.link = link;
  }

  get(): FlightBookingLink | undefined {
    return this.link;
  }
}
