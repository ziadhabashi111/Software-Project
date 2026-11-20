import { Types } from 'mongoose';

interface SourceActivity {
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
}

interface SourceDay {
  _id: { toString(): string };
  city: string;
  notes?: string;
  activities: SourceActivity[];
}

export interface ClonedActivity {
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
}

export interface ClonedDay {
  _id: Types.ObjectId;
  city: string;
  notes?: string;
  activities: ClonedActivity[];
}

/**
 * ITN-21: a deep copy of the days and activities, so the clone never shares
 * anything with the original. Every day gets a new id; `dayIdMap` says which
 * old day became which new one, so the budget entries can follow.
 *
 * Activity images are not copied: the files belong to the original author
 * (only the uploader can reuse or delete them, GEN-08).
 */
export function cloneDays(days: SourceDay[]): {
  days: ClonedDay[];
  dayIdMap: Record<string, string>;
} {
  const dayIdMap: Record<string, string> = {};
  const copies = days.map((day): ClonedDay => {
    const id = new Types.ObjectId();
    dayIdMap[day._id.toString()] = id.toString();
    return {
      _id: id,
      city: day.city,
      ...(day.notes ? { notes: day.notes } : {}),
      activities: day.activities.map((activity): ClonedActivity => ({
        name: activity.name,
        ...(activity.description ? { description: activity.description } : {}),
        ...(activity.time ? { time: activity.time } : {}),
        ...(activity.cost != null ? { cost: activity.cost } : {}),
        ...(activity.currency ? { currency: activity.currency } : {}),
      })),
    };
  });
  return { days: copies, dayIdMap };
}
