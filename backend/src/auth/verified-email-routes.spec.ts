import { FlightBookingsController } from '../flight-bookings/flight-bookings.controller';
import { HotelBookingsController } from '../hotel-bookings/hotel-bookings.controller';
import { REQUIRE_VERIFIED_EMAIL_KEY } from './auth.constants';

/** The route's handler function, read without binding it (the mark lives on it). */
function handler(controller: { prototype: object }, name: string): object {
  return Object.getOwnPropertyDescriptor(controller.prototype, name)!
    .value as object;
}

const isMarked = (controller: { prototype: object }, name: string): boolean =>
  Reflect.getMetadata(REQUIRE_VERIFIED_EMAIL_KEY, handler(controller, name)) ===
  true;

// ACC-02 blocks the routes that create a booking. If one of these marks is
// removed, the block silently stops working, so they are pinned here.
describe('routes that need a verified email (ACC-02)', () => {
  it('marks the flight booking hold (seats are held and payment follows)', () => {
    expect(isMarked(FlightBookingsController, 'hold')).toBe(true);
  });

  it('marks the hotel reservation (rooms are held and payment follows)', () => {
    expect(isMarked(HotelBookingsController, 'create')).toBe(true);
  });

  // The price summary books nothing, so an unverified user may still look.
  it('does not mark the flight booking summary, which holds nothing', () => {
    expect(isMarked(FlightBookingsController, 'summary')).toBe(false);
  });
});
