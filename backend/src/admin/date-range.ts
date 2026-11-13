import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a filter date. A plain `YYYY-MM-DD` covers the whole day (UTC): the
 * start of that day for a range start, the last millisecond for a range end.
 * A full ISO timestamp is used exactly as given.
 */
export function parseRangeDate(value: string, endOfRange: boolean): Date {
  if (DATE_ONLY.test(value)) {
    return new Date(
      `${value}T${endOfRange ? '23:59:59.999' : '00:00:00.000'}Z`,
    );
  }
  return new Date(value);
}

/** For a `to` filter: the range must not end before its `from`. */
@ValidatorConstraint({ name: 'isNotBeforeFrom', async: false })
export class IsNotBeforeFrom implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const from = (args.object as { from?: unknown }).from;
    if (typeof value !== 'string' || typeof from !== 'string') return true;
    const start = parseRangeDate(from, false).getTime();
    const end = parseRangeDate(value, true).getTime();
    return Number.isNaN(start) || Number.isNaN(end) || end >= start;
  }

  defaultMessage(): string {
    return 'End date must not be before the start date';
  }
}
