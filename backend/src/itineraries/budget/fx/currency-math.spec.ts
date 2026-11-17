import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { assertCurrencyCode, convert, rateFor, round2 } from './currency-math';
import type { RateTable } from './currency-math';

const table: RateTable = {
  base: 'USD',
  rates: { EUR: 0.9, EGP: 50, GBP: 0.8 },
  rateDate: '2026-11-17',
  stale: false,
};

describe('currency conversion (ITN-18)', () => {
  it('converts through the base currency', () => {
    expect(convert(100, 'USD', 'EUR', table)).toBeCloseTo(90);
    expect(convert(90, 'EUR', 'USD', table)).toBeCloseTo(100);
    expect(convert(90, 'EUR', 'EGP', table)).toBeCloseTo(5000);
  });

  it('leaves an amount alone when the currency is the same', () => {
    expect(convert(12.34, 'EUR', 'EUR', { ...table, rates: {} })).toBe(12.34);
  });

  it('failure case 1: a malformed currency code is a 400 on that field', () => {
    for (const bad of ['usd', 'US', 'USDD', '12A', '']) {
      expect(() => assertCurrencyCode(bad)).toThrow(BadRequestException);
    }
    expect(() => assertCurrencyCode('USD')).not.toThrow();
  });

  it('failure case 2: a well-formed code with no rate is a 422 naming the currency', () => {
    try {
      convert(10, 'ZZZ', 'EUR', table);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(
        (error as UnprocessableEntityException).getResponse(),
      ).toMatchObject({
        code: 'RATE_UNAVAILABLE',
        currency: 'ZZZ',
      });
    }
    expect(() => convert(10, 'EUR', 'ZZZ', table)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('ignores rates that are zero, negative or not numbers', () => {
    const bad = { ...table, rates: { EUR: 0, GBP: -1, EGP: Number.NaN } };
    expect(rateFor(bad, 'EUR')).toBeUndefined();
    expect(rateFor(bad, 'GBP')).toBeUndefined();
    expect(rateFor(bad, 'EGP')).toBeUndefined();
    expect(rateFor(bad, 'USD')).toBe(1);
  });

  it('rounds to cents', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.345)).toBe(2.35);
    expect(round2(10)).toBe(10);
  });
});
