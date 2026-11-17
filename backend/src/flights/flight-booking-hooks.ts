import { Injectable } from '@nestjs/common';

/** What flights need from flight bookings (Yahia). */
export interface FlightBookingLink {
  /** Users with a Confirmed booking on the flight (FLT-05 notifications, FLT-29). */
  getConfirmedPassengerUserIds(flightId: string): Promise<string[]>;
}

/**
 * Flight bookings register here so this module does not depend on them:
 *
 *   constructor(hooks: FlightBookingHooks) {}
 *   onModuleInit() { this.hooks.register(this); }
 *
 * Until they do, a flight has no bookings to notify.
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
