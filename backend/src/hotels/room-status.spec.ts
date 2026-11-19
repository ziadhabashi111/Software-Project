import { parseDate } from '../hotel-bookings/stay-rules';
import { nightStatus } from './room-status';
import type { DayRange } from './date-ranges';

const range = (from: string, to: string): DayRange => ({
  from: parseDate(from),
  to: parseDate(to),
});
const night = parseDate('2027-03-10');

const open = {
  isActive: true,
  availability: [range('2027-03-01', '2027-03-31')],
  blocked: [] as DayRange[],
};

describe('room status of one night (HTL-08: Available, Booked or Blocked)', () => {
  it('is Available when the night is offered, not blocked and not taken', () => {
    expect(nightStatus(open, night)).toEqual({ status: 'Available' });
  });

  it('is Booked, with the reservation reference, when a reservation holds it', () => {
    expect(
      nightStatus(open, night, { reservationId: 'r1', reference: 'HTL-ABC' }),
    ).toEqual({ status: 'Booked', reference: 'HTL-ABC', reservationId: 'r1' });
  });

  it('is Booked with no reference while the reservation is still an unpaid hold', () => {
    expect(
      nightStatus(open, night, { reservationId: 'r2', reference: null }),
    ).toEqual({ status: 'Booked', reference: null, reservationId: 'r2' });
  });

  it('is Blocked when the moderator blocked it', () => {
    expect(
      nightStatus(
        { ...open, blocked: [range('2027-03-09', '2027-03-11')] },
        night,
      ),
    ).toEqual({ status: 'Blocked', reason: 'BLOCKED' });
  });

  it('is Blocked when the room is deactivated, or the night is not in any availability range', () => {
    expect(nightStatus({ ...open, isActive: false }, night)).toEqual({
      status: 'Blocked',
      reason: 'DEACTIVATED',
    });
    expect(
      nightStatus(
        { ...open, availability: [range('2027-04-01', '2027-04-30')] },
        night,
      ),
    ).toEqual({ status: 'Blocked', reason: 'NOT_OFFERED' });
  });

  it('shows a reservation before anything else', () => {
    expect(
      nightStatus(
        { ...open, blocked: [range('2027-03-01', '2027-03-31')] },
        night,
        { reservationId: 'r1', reference: 'HTL-ABC' },
      ).status,
    ).toBe('Booked');
  });
});
