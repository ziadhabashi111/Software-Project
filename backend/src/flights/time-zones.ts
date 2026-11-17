/**
 * GEN-06 / FLT-03: flight times are entered in the airport's local time and
 * stored in UTC. Uses the built-in Intl time zone data, so no extra package.
 */

export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

export interface LocalTime {
  /** `YYYY-MM-DD` in the airport's zone. */
  date: string;
  /** `HH:mm` in the airport's zone. */
  time: string;
  /** Offset from UTC at that moment, for example `+02:00`. */
  offset: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock fields of an instant in a zone, as if they were UTC fields. */
function wallClockMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** Milliseconds the zone is ahead of UTC at that instant. */
function offsetMs(instant: Date, timeZone: string): number {
  const rounded = Math.floor(instant.getTime() / 1000) * 1000;
  return wallClockMs(instant, timeZone) - rounded;
}

const pad = (value: number): string => String(value).padStart(2, '0');

function formatOffset(ms: number): string {
  const minutes = Math.round(ms / 60000);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Local date, time and UTC offset of an instant in an airport's zone. */
export function utcToLocal(instant: Date, timeZone: string): LocalTime {
  const offset = offsetMs(instant, timeZone);
  const shifted = new Date(instant.getTime() + offset);
  const iso = shifted.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    offset: formatOffset(offset),
  };
}

/**
 * Converts `YYYY-MM-DDTHH:mm` entered at an airport to the UTC instant.
 * Returns `null` when the text is malformed or the wall-clock time does not
 * exist there (the hour skipped when clocks go forward).
 */
export function localToUtc(local: string, timeZone: string): Date | null {
  if (!LOCAL_DATE_TIME.test(local)) return null;
  const asIfUtc = Date.parse(`${local}:00Z`);
  if (Number.isNaN(asIfUtc)) return null;

  const guess = new Date(asIfUtc - offsetMs(new Date(asIfUtc), timeZone));
  const result = new Date(asIfUtc - offsetMs(guess, timeZone));

  const back = utcToLocal(result, timeZone);
  return `${back.date}T${back.time}` === local ? result : null;
}

/** Whole minutes between two instants. */
export function durationMinutes(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60000);
}
