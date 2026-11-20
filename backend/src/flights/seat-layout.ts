import { CabinClass } from './flight-status';

/** Allowed seats per row when a moderator sets the layout (FLT-28). */
export const MIN_SEATS_PER_ROW = 2;
export const MAX_SEATS_PER_ROW = 10;

const LETTERS = 'ABCDEFGHIJ';

/**
 * FLT-28: seats per row of a cabin. A moderator may set it; otherwise wide
 * cabins (Economy, Premium Economy) have 6 and Business and First have 4.
 */
export function seatsPerRowOf(cabin: {
  cabinClass: CabinClass;
  seatsPerRow?: number | null;
}): number {
  if (cabin.seatsPerRow) return cabin.seatsPerRow;
  return cabin.cabinClass === CabinClass.BUSINESS ||
    cabin.cabinClass === CabinClass.FIRST
    ? 4
    : 6;
}

/** Every seat label of a cabin in order: `1A`, `1B`, ... (last row may be partial). */
export function seatLabels(totalSeats: number, perRow: number): string[] {
  return Array.from(
    { length: totalSeats },
    (_, i) => `${Math.floor(i / perRow) + 1}${LETTERS[i % perRow]}`,
  );
}

/** The cabin's seats grouped by row, for the seat map. */
export function seatRows(
  totalSeats: number,
  perRow: number,
): { row: number; seats: string[] }[] {
  const labels = seatLabels(totalSeats, perRow);
  const rows: { row: number; seats: string[] }[] = [];
  for (let i = 0; i < labels.length; i += perRow) {
    rows.push({ row: rows.length + 1, seats: labels.slice(i, i + perRow) });
  }
  return rows;
}

/** A label such as `12C` normalised to upper case, or null if malformed. */
export function normalizeSeat(label: string): string | null {
  const match = /^([1-9]\d{0,3})([A-Ja-j])$/.exec(label.trim());
  return match ? `${match[1]}${match[2].toUpperCase()}` : null;
}

/** True when `label` is one of the cabin's seats. */
export function isSeatInLayout(
  label: string,
  totalSeats: number,
  perRow: number,
): boolean {
  const seat = normalizeSeat(label);
  if (!seat) return false;
  const row = Number(seat.slice(0, -1));
  const column = LETTERS.indexOf(seat.slice(-1));
  if (column < 0 || column >= perRow) return false;
  return (row - 1) * perRow + column < totalSeats;
}
