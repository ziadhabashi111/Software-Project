import { fieldError } from '../common/validation/validation-errors';
import { formatDate, nightsOf, parseDate } from '../hotel-bookings/stay-rules';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A run of calendar days, **both ends included**, as midnight UTC (HTL-04, HTL-06). */
export interface DayRange {
  from: Date;
  to: Date;
}

/** What a room needs to answer "can this stay be booked?" (HTL-04, HTL-06). */
export interface BookableRoom {
  isActive: boolean;
  availability: DayRange[];
  blocked: DayRange[];
}

/**
 * A calendar date that really exists. JavaScript rolls 2027-02-30 over to
 * 2027-03-02, so the date must format back to exactly what was typed.
 */
export function parseRealDay(value: string, field: string): Date {
  const day = parseDate(value);
  if (Number.isNaN(day.getTime()) || formatDate(day) !== value) {
    throw fieldError(field, 'Use a real date as YYYY-MM-DD');
  }
  return day;
}

/** Reads `YYYY-MM-DD` twice; both must be real dates and the end not before the start. */
export function parseRange(from: string, to: string): DayRange {
  const start = parseRealDay(from, 'from');
  const end = parseRealDay(to, 'to');
  if (end.getTime() < start.getTime()) {
    throw fieldError('to', 'The end date cannot be before the start date');
  }
  return { from: start, to: end };
}

/** Two ranges overlap when they share at least one day. */
export function rangesOverlap(a: DayRange, b: DayRange): boolean {
  return (
    a.from.getTime() <= b.to.getTime() && b.from.getTime() <= a.to.getTime()
  );
}

/**
 * HTL-04: availability ranges of one room must not overlap. `ignoreIndex` is
 * the range being edited, so it can be changed in place.
 */
export function assertNoOverlap(
  existing: DayRange[],
  candidate: DayRange,
  ignoreIndex?: number,
): void {
  const clash = existing.find(
    (range, index) => index !== ignoreIndex && rangesOverlap(range, candidate),
  );
  if (clash) {
    throw fieldError(
      'from',
      `This range overlaps the existing range ${formatDate(clash.from)} to ${formatDate(clash.to)}`,
    );
  }
}

/** True when the night lies inside any of the ranges. */
export function covers(ranges: DayRange[], night: Date): boolean {
  const time = night.getTime();
  return ranges.some(
    (range) => range.from.getTime() <= time && time <= range.to.getTime(),
  );
}

/**
 * HTL-04, HTL-06: the booking module is told a room is bookable only when it
 * is active, every night of the stay is inside an availability range and no
 * night is blocked. Check-out is the morning after the last night.
 */
export function roomBookable(
  room: BookableRoom,
  checkIn: Date,
  checkOut: Date,
): boolean {
  if (!room.isActive) return false;
  return nightsOf(checkIn, checkOut).every(
    (night) => covers(room.availability, night) && !covers(room.blocked, night),
  );
}

/** Every night of the ranges, both ends included, without repeats. */
export function nightsOfRanges(ranges: DayRange[]): Date[] {
  const times = new Set<number>();
  for (const range of ranges) {
    for (
      let t = range.from.getTime();
      t <= range.to.getTime();
      t += MS_PER_DAY
    ) {
      times.add(t);
    }
  }
  return [...times].sort((a, b) => a - b).map((t) => new Date(t));
}

/**
 * HTL-05: the nights that were open before an edit and are not any more.
 * Those are the nights that must hold no reservation.
 */
export function removedNights(before: DayRange[], after: DayRange[]): Date[] {
  return nightsOfRanges(before).filter((night) => !covers(after, night));
}
