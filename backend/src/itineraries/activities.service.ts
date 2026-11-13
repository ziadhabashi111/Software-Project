import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';
import { ItineraryRepository } from './itinerary.repository';
import { ActivityView, toActivityView } from './itinerary-view';
import type { Activity, ItineraryDocument } from './schemas/itinerary.schema';

type Caller = Pick<AuthUser, 'id' | 'role'>;

function findActivity(
  itinerary: ItineraryDocument,
  activityId: string,
): { activities: Activity[]; index: number } {
  for (const day of itinerary.days) {
    const index = day.activities.findIndex(
      (activity) => activity._id.toString() === activityId,
    );
    if (index !== -1) return { activities: day.activities, index };
  }
  throw new NotFoundException('Activity not found');
}

/** ITN-10: activities of an itinerary day. */
@Injectable()
export class ActivitiesService {
  constructor(private readonly repository: ItineraryRepository) {}

  async add(
    user: Caller,
    itineraryId: string,
    dayId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityView> {
    const { result } = await this.repository.change(
      itineraryId,
      user,
      (itinerary) => {
        const day = itinerary.days.find((d) => d._id.toString() === dayId);
        if (!day) throw new NotFoundException('Day not found');
        day.activities.push({
          name: dto.name,
          ...(dto.description ? { description: dto.description } : {}),
          ...(dto.time ? { time: dto.time } : {}),
          ...(dto.cost !== undefined ? { cost: dto.cost } : {}),
          ...(dto.currency ? { currency: dto.currency } : {}),
          images: [],
        } as unknown as Activity); // Mongoose adds the _id
        return day.activities[day.activities.length - 1];
      },
    );
    return toActivityView(result);
  }

  async update(
    user: Caller,
    activityId: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityView> {
    const itineraryId = await this.itineraryOf(activityId);
    const { result } = await this.repository.change(
      itineraryId,
      user,
      (itinerary) => {
        const { activities, index } = findActivity(itinerary, activityId);
        const activity = activities[index];
        if (dto.name !== undefined) activity.name = dto.name;
        if (dto.description !== undefined) {
          activity.description = dto.description ?? undefined;
        }
        if (dto.time !== undefined) activity.time = dto.time ?? undefined;
        if (dto.cost !== undefined) activity.cost = dto.cost ?? undefined;
        if (dto.currency !== undefined) {
          activity.currency = dto.currency ?? undefined;
        }
        return activity;
      },
    );
    return toActivityView(result);
  }

  async remove(user: Caller, activityId: string): Promise<void> {
    const itineraryId = await this.itineraryOf(activityId);
    await this.repository.change(itineraryId, user, (itinerary) => {
      const { activities, index } = findActivity(itinerary, activityId);
      activities.splice(index, 1);
    });
  }

  /** Activities are addressed by their own id; find the itinerary that holds it. */
  private async itineraryOf(activityId: string): Promise<string> {
    const itinerary = await this.repository.findByActivityId(activityId);
    if (!itinerary) throw new NotFoundException('Activity not found');
    return itinerary.id;
  }
}
