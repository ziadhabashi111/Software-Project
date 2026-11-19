import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import { cloneDays } from './clone-itinerary';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryRepository } from './itinerary.repository';
import type { ItineraryView } from './itinerary-view';
import { Visibility } from './schemas/itinerary.schema';

type Caller = Pick<AuthUser, 'id' | 'role'>;

/**
 * ITN-21: copy an itinerary into the caller's own account. The copy is
 * private, credits the original author, and shares nothing with the original:
 * days and activities are deep copies and the budget entries are copied too.
 * Anyone may copy a public itinerary that is not hidden and whose author is
 * still active; anyone else's private itinerary answers 404.
 */
@Injectable()
export class ItineraryCloneService {
  constructor(
    private readonly repository: ItineraryRepository,
    private readonly budgets: ItineraryBudgets,
    private readonly users: UsersService,
    private readonly itineraries: ItinerariesService,
  ) {}

  async clone(user: Caller, id: string): Promise<ItineraryView> {
    const source = await this.repository.findById(id);
    if (!source) throw new NotFoundException('Itinerary not found');

    const author = await this.users.findById(source.owner.toString());
    const isMine = source.owner.toString() === user.id;
    const isPublic =
      source.visibility === Visibility.PUBLIC &&
      !source.isHidden &&
      author !== null &&
      author.status !== UserStatus.DEACTIVATED;
    if (!isMine && !isPublic)
      throw new NotFoundException('Itinerary not found');

    const { days, dayIdMap } = cloneDays(source.days);
    const copy = await this.repository.createClone({
      owner: user.id,
      title: source.title,
      countries: source.countries,
      startDate: source.startDate,
      days,
      clonedFrom: {
        itinerary: source._id,
        author: source.owner,
        authorName: author?.name ?? 'Traveller',
      },
    });

    const budgets = this.budgets.get();
    try {
      await budgets?.cloneBudgets?.(source.id, copy.id, dayIdMap);
    } catch (error) {
      // No half-made copy: remove it, and any budget rows already copied, so
      // the traveller can simply try again.
      await Promise.allSettled([
        this.repository.deleteById(copy.id),
        budgets?.removeItinerary(copy.id),
      ]);
      throw error;
    }
    return this.itineraries.get(user, copy.id);
  }
}
