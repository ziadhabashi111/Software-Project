import { Types } from 'mongoose';

/** Database fields that belong to the original row and are not copied. */
const NOT_COPIED = new Set([
  '_id',
  'createdAt',
  'updatedAt',
  'itineraryId',
  'dayId',
]);

/**
 * ITN-21: copies budget rows (entries or transport costs) onto a cloned
 * itinerary. Each row moves to its day's new id; a row whose day was not
 * cloned is skipped rather than attached to the wrong day. The input rows
 * are never changed.
 */
export function remapToClone<T extends { dayId: Types.ObjectId }>(
  rows: T[],
  dayIdMap: Record<string, string>,
  cloneItineraryId: Types.ObjectId,
): (Omit<T, 'dayId' | '_id' | 'createdAt' | 'updatedAt' | 'itineraryId'> & {
  itineraryId: Types.ObjectId;
  dayId: Types.ObjectId;
})[] {
  return rows.flatMap((row) => {
    const newDay = dayIdMap[row.dayId.toString()];
    if (!newDay) return [];
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!NOT_COPIED.has(key)) copy[key] = value;
    }
    return [
      {
        ...copy,
        itineraryId: cloneItineraryId,
        dayId: new Types.ObjectId(newDay),
      } as never,
    ];
  });
}
