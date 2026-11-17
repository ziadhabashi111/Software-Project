import { durationMinutes, localToUtc, utcToLocal } from './time-zones';

describe('local airport time and UTC (FLT-03, GEN-06)', () => {
  it('converts winter and summer local times with the right offsets', () => {
    // Cairo observes DST (UTC+3) from the last Friday of April.
    expect(localToUtc('2027-01-15T10:30', 'Africa/Cairo')?.toISOString()).toBe(
      '2027-01-15T08:30:00.000Z',
    );
    expect(localToUtc('2027-07-15T10:30', 'Africa/Cairo')?.toISOString()).toBe(
      '2027-07-15T07:30:00.000Z',
    );
    expect(
      localToUtc('2027-01-15T08:00', 'America/New_York')?.toISOString(),
    ).toBe('2027-01-15T13:00:00.000Z');
    expect(localToUtc('2027-07-15T08:00', 'Asia/Tokyo')?.toISOString()).toBe(
      '2027-07-14T23:00:00.000Z',
    );
  });

  it('converts back to the local date, time and offset', () => {
    expect(
      utcToLocal(new Date('2027-01-15T13:00:00Z'), 'America/New_York'),
    ).toEqual({
      date: '2027-01-15',
      time: '08:00',
      offset: '-05:00',
    });
    expect(utcToLocal(new Date('2027-07-14T23:00:00Z'), 'Asia/Tokyo')).toEqual({
      date: '2027-07-15',
      time: '08:00',
      offset: '+09:00',
    });
  });

  it('keeps the local date when UTC is already the next day', () => {
    const utc = localToUtc('2027-03-10T23:30', 'America/New_York');
    expect(utc?.toISOString()).toBe('2027-03-11T04:30:00.000Z');
    expect(utcToLocal(utc as Date, 'America/New_York').date).toBe('2027-03-10');
  });

  it('rejects a local time that does not exist when clocks go forward', () => {
    expect(localToUtc('2027-03-14T02:30', 'America/New_York')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(localToUtc('2027-01-15 10:30', 'Africa/Cairo')).toBeNull();
    expect(localToUtc('2027-13-15T10:30', 'Africa/Cairo')).toBeNull();
    expect(localToUtc('2027-02-30T10:30', 'Africa/Cairo')).toBeNull();
  });

  it('measures duration in minutes between instants', () => {
    expect(
      durationMinutes(
        new Date('2027-01-15T08:00:00Z'),
        new Date('2027-01-15T11:45:00Z'),
      ),
    ).toBe(225);
  });
});
