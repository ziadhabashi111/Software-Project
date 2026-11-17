import { fieldError } from '../../../common/validation/validation-errors';
import { UnprocessableEntityException } from '@nestjs/common';

/** Rates against one base currency, as stored and returned by the provider. */
export interface RateTable {
  base: string;
  rates: Record<string, number>;
  /** `YYYY-MM-DD`, shown to the user (ITN-18). */
  rateDate: string;
  /** True when the provider could not be reached and the cached rates were used. */
  stale: boolean;
}

export const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/** A currency code the user typed must at least look like one (400). */
export function assertCurrencyCode(code: string, field = 'currency'): void {
  if (!CURRENCY_FORMAT.test(code)) {
    throw fieldError(field, 'Use a three-letter currency code such as USD');
  }
}

/** Units of `code` per 1 base, or undefined when the table has no rate for it. */
export function rateFor(table: RateTable, code: string): number | undefined {
  if (code === table.base) return 1;
  const rate = table.rates[code];
  return typeof rate === 'number' && rate > 0 ? rate : undefined;
}

/**
 * Converts an amount through the base currency. A well-formed code with no
 * rate in the table is a different problem from a malformed code (422, not
 * 400): the request is fine but we cannot convert it right now.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  table: RateTable,
): number {
  if (from === to) return amount;
  const fromRate = rateFor(table, from);
  const toRate = rateFor(table, to);
  for (const [code, rate] of [
    [from, fromRate],
    [to, toRate],
  ] as const) {
    if (rate === undefined) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `No exchange rate is available for ${code}`,
        code: 'RATE_UNAVAILABLE',
        currency: code,
      });
    }
  }
  return (amount / (fromRate as number)) * (toRate as number);
}

export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
