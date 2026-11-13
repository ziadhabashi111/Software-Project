const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Dates in an itinerary are calendar dates, stored as midnight UTC. */
export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Day `n` of an itinerary falls `n - 1` days after its start date (ITN-05). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export interface CityGroup {
  city: string;
  /** Day numbers, 1-based. */
  startDay: number;
  endDay: number;
  dayCount: number;
  startDate: string;
  endDate: string;
  dayIds: string[];
}

/** Consecutive days in the same city form one group (ITN-09). */
export function buildGroups(
  days: { id: string; city: string }[],
  startDate: Date,
): CityGroup[] {
  const groups: CityGroup[] = [];
  days.forEach((day, index) => {
    const number = index + 1;
    const date = formatDate(addDays(startDate, index));
    const last = groups.at(-1);
    if (last && last.city === day.city) {
      last.endDay = number;
      last.dayCount += 1;
      last.endDate = date;
      last.dayIds.push(day.id);
    } else {
      groups.push({
        city: day.city,
        startDay: number,
        endDay: number,
        dayCount: 1,
        startDate: date,
        endDate: date,
        dayIds: [day.id],
      });
    }
  });
  return groups;
}
