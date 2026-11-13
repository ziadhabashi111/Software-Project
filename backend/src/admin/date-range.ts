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
