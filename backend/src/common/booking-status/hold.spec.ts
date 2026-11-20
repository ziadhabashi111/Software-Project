import { HOLD_MINUTES as FLIGHT_HOLD_MINUTES } from '../../flight-bookings/flight-booking-holds.service';
import { HOLD_MINUTES as HOTEL_HOLD_MINUTES } from '../../hotel-bookings/stay-rules';
import { HOLD_MINUTES, holdExpiredMessage, holdExpiresAt } from './hold';

describe('booking holds (FLT-22, HTL-18)', () => {
  it('is one 10-minute hold shared by flights and hotels', () => {
    expect(HOLD_MINUTES).toBe(10);
    expect(FLIGHT_HOLD_MINUTES).toBe(HOLD_MINUTES);
    expect(HOTEL_HOLD_MINUTES).toBe(HOLD_MINUTES);
  });

  it('ends the hold HOLD_MINUTES after it starts', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(holdExpiresAt(now)).toEqual(new Date('2026-11-20T10:10:00Z'));
  });

  it('derives the expired message from the hold length', () => {
    expect(holdExpiredMessage()).toContain(`${HOLD_MINUTES}-minute hold`);
  });
});
