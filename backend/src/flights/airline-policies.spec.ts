import { BadRequestException } from '@nestjs/common';
import { normalizeTiers, refundPercentFor } from './airline-policies';

const tiers = [
  { daysBefore: 3, refundPercent: 50 },
  { daysBefore: 14, refundPercent: 100 },
  { daysBefore: 1, refundPercent: 20 },
];

describe('normalizeTiers (FLT-09)', () => {
  it('sorts from the longest notice to the shortest', () => {
    expect(normalizeTiers(tiers).map((t) => t.daysBefore)).toEqual([14, 3, 1]);
  });

  it('accepts an empty policy', () => {
    expect(normalizeTiers([])).toEqual([]);
  });

  it('rejects a repeated threshold on that field', () => {
    try {
      normalizeTiers([
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
      ]);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        errors: { field: string }[];
      };
      expect(body.errors[0].field).toBe('tiers.1.daysBefore');
    }
  });
});

describe('refundPercentFor (FLT-09)', () => {
  it('uses the highest threshold that does not exceed the days remaining', () => {
    expect(refundPercentFor(tiers, 30)).toBe(100);
    expect(refundPercentFor(tiers, 14)).toBe(100);
    expect(refundPercentFor(tiers, 13)).toBe(50);
    expect(refundPercentFor(tiers, 3)).toBe(50);
    expect(refundPercentFor(tiers, 2)).toBe(20);
  });

  it('is 0% when no tier applies', () => {
    expect(refundPercentFor(tiers, 0)).toBe(0);
    expect(refundPercentFor([], 10)).toBe(0);
  });

  it('supports a day-0 tier for same-day cancellations', () => {
    expect(refundPercentFor([{ daysBefore: 0, refundPercent: 10 }], 0)).toBe(
      10,
    );
  });
});
