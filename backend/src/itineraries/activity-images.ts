import { NotFoundException } from '@nestjs/common';

/** Every image url of the activities of these days, in order (ITN-12). */
export function imageUrlsOf(
  days: { activities: { images: { url: string }[] }[] }[],
): string[] {
  return days.flatMap((day) =>
    day.activities.flatMap((activity) =>
      activity.images.map((image) => image.url),
    ),
  );
}

/** The activity with this id, wherever it is in the itinerary; 404 if it is gone. */
export function locateActivity<A extends { _id: { toString(): string } }>(
  days: { activities: A[] }[],
  activityId: string,
): A {
  for (const day of days) {
    const found = day.activities.find(
      (activity) => activity._id.toString() === activityId,
    );
    if (found) return found;
  }
  throw new NotFoundException('Activity not found');
}
