import { BadRequestException } from '@nestjs/common';
import { parseDate } from '../hotel-bookings/stay-rules';
import {
  assertNoOverlap,
  covers,
  parseRange,
  rangesOverlap,
  removedNights,
  roomBookable,
} from './date-ranges';
import type { DayRange } from './date-ranges';

const range = (from: string, to: string): DayRange => ({
  from: parseDate(from),
  to: parseDate(to),
});
const d = parseDate;

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      errors: { field: string }[];
    };
    return body.errors[0].field;
  }
  return undefined;
}

describe('date ranges (HTL-04, HTL-06)', () => {
  describe('parseRange', () => {
    it('reads two calendar dates, both ends included', () => {
      expect(parseRange('2027-03-01', '2027-03-10')).toEqual(
        range('2027-03-01', '2027-03-10'),
      );
      expect(parseRange('2027-03-05', '2027-03-05')).toEqual(
        range('2027-03-05', '2027-03-05'),
      );
    });

    it('rejects a date that does not exist, and an end before the start', () => {
      expect(fieldOf(() => parseRange('2027-02-30', '2027-03-10'))).toBe(
        'from',
      );
      expect(fieldOf(() => parseRange('2027-03-01', '2027-13-10'))).toBe('to');
      expect(fieldOf(() => parseRange('2027-03-10', '2027-03-01'))).toBe('to');
    });
  });

  describe('rangesOverlap', () => {
    it('counts a shared day as an overlap (both ends are included)', () => {
      expect(
        rangesOverlap(
          range('2027-03-01', '2027-03-05'),
          range('2027-03-05', '2027-03-09'),
        ),
      ).toBe(true);
      expect(
        rangesOverlap(
          range('2027-03-01', '2027-03-05'),
          range('2027-03-02', '2027-03-03'),
        ),
      ).toBe(true);
    });

    it('does not overlap when there is a free day between, or when back to back', () => {
      expect(
        rangesOverlap(
          range('2027-03-01', '2027-03-04'),
          range('2027-03-06', '2027-03-09'),
        ),
      ).toBe(false);
      expect(
        rangesOverlap(
          range('2027-03-01', '2027-03-04'),
          range('2027-03-05', '2027-03-09'),
        ),
      ).toBe(false);
    });
  });

  describe('assertNoOverlap', () => {
    const existing = [
      range('2027-03-01', '2027-03-10'),
      range('2027-04-01', '2027-04-10'),
    ];

    it('accepts a range that fits between the others', () => {
      expect(() =>
        assertNoOverlap(existing, range('2027-03-11', '2027-03-31')),
      ).not.toThrow();
    });

    it('rejects an overlap with a 400 on the range, naming the clash', () => {
      expect(
        fieldOf(() =>
          assertNoOverlap(existing, range('2027-03-09', '2027-03-20')),
        ),
      ).toBe('from');
    });

    it('ignores the range being edited, so it can be changed in place', () => {
      expect(() =>
        assertNoOverlap(existing, range('2027-03-02', '2027-03-12'), 0),
      ).not.toThrow();
      expect(
        fieldOf(() =>
          assertNoOverlap(existing, range('2027-03-02', '2027-04-02'), 0),
        ),
      ).toBe('from');
    });
  });

  describe('covers', () => {
    const ranges = [
      range('2027-03-01', '2027-03-10'),
      range('2027-03-12', '2027-03-20'),
    ];
    it('is true for a night inside any range, ends included', () => {
      expect(covers(ranges, d('2027-03-01'))).toBe(true);
      expect(covers(ranges, d('2027-03-10'))).toBe(true);
      expect(covers(ranges, d('2027-03-15'))).toBe(true);
    });
    it('is false in the gap and outside', () => {
      expect(covers(ranges, d('2027-03-11'))).toBe(false);
      expect(covers(ranges, d('2027-02-28'))).toBe(false);
    });
  });

  describe('roomBookable (what the booking module is told)', () => {
    const room = {
      isActive: true,
      availability: [range('2027-03-01', '2027-03-31')],
      blocked: [] as DayRange[],
    };

    it('is true when every night of the stay is open', () => {
      expect(roomBookable(room, d('2027-03-10'), d('2027-03-13'))).toBe(true);
    });

    it('treats check-out as the morning after: it need not be an open night', () => {
      expect(roomBookable(room, d('2027-03-29'), d('2027-04-01'))).toBe(true);
      expect(roomBookable(room, d('2027-03-30'), d('2027-04-02'))).toBe(false);
    });

    it('is false when one night falls outside every availability range', () => {
      expect(roomBookable(room, d('2027-02-27'), d('2027-03-02'))).toBe(false);
    });

    it('is false when one night is blocked, and when the room is deactivated', () => {
      const blocked = { ...room, blocked: [range('2027-03-12', '2027-03-12')] };
      expect(roomBookable(blocked, d('2027-03-10'), d('2027-03-13'))).toBe(
        false,
      );
      expect(roomBookable(blocked, d('2027-03-13'), d('2027-03-15'))).toBe(
        true,
      );
      expect(
        roomBookable(
          { ...room, isActive: false },
          d('2027-03-10'),
          d('2027-03-12'),
        ),
      ).toBe(false);
    });

    it('can span two adjacent availability ranges', () => {
      const split = {
        ...room,
        availability: [
          range('2027-03-01', '2027-03-10'),
          range('2027-03-11', '2027-03-20'),
        ],
      };
      expect(roomBookable(split, d('2027-03-09'), d('2027-03-13'))).toBe(true);
    });
  });

  describe('removedNights (what editing or removing a range takes away)', () => {
    const before = [range('2027-03-01', '2027-03-10')];

    it('lists every night that was open and no longer is', () => {
      expect(removedNights(before, [])).toHaveLength(10);
      expect(
        removedNights(before, [range('2027-03-01', '2027-03-07')]).map((n) =>
          n.getUTCDate(),
        ),
      ).toEqual([8, 9, 10]);
    });

    it('is empty when nothing is taken away, including when a range only grows', () => {
      expect(removedNights(before, before)).toEqual([]);
      expect(
        removedNights(before, [range('2027-02-20', '2027-03-20')]),
      ).toEqual([]);
    });

    it('does not count a night that another range still covers', () => {
      const after = [
        range('2027-03-01', '2027-03-05'),
        range('2027-03-06', '2027-03-10'),
      ];
      expect(removedNights(before, after)).toEqual([]);
    });
  });
});
