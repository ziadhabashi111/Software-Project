import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionService } from '../auth/sessions/session.service';
import { fieldError } from '../common/validation/validation-errors';
import { CURRENCY_CATALOG } from './currency-catalog';
import type { CurrencyCatalog } from './currency-catalog';
import { DeactivationBlockers } from './deactivation-blockers';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { toProfile, UserProfile } from './user-profile';
import { UserStatus } from './user-status';
import { UsersService } from './users.service';

@Injectable()
export class ProfileService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly blockers: DeactivationBlockers,
    @Optional()
    @Inject(CURRENCY_CATALOG)
    private readonly currencies?: CurrencyCatalog,
  ) {}

  async get(userId: string): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Not logged in');
    return toProfile(user);
  }

  /** ACC-09: all fields are validated first, then saved together. */
  async update(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const patch = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.preferredCurrency !== undefined
        ? { preferredCurrency: dto.preferredCurrency }
        : {}),
    };
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }
    if (
      patch.preferredCurrency &&
      this.currencies &&
      !(await this.currencies.isSupported(patch.preferredCurrency))
    ) {
      throw fieldError('preferredCurrency', 'Currency is not supported');
    }

    const updated = await this.users.updateProfile(userId, patch);
    if (!updated) throw new UnauthorizedException('Not logged in');
    return toProfile(updated);
  }

  /**
   * ACC-12: blocked while the user has upcoming Confirmed bookings. A
   * deactivated user is signed out everywhere and cannot log in again; their
   * posts and public itineraries are hidden by those modules.
   */
  async deactivate(userId: string): Promise<void> {
    if (await this.blockers.hasUpcomingBookings(userId)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message:
          'You cannot deactivate your account while you have upcoming confirmed bookings. Cancel them first.',
        code: 'UPCOMING_BOOKINGS',
      });
    }
    await this.users.setStatus(userId, UserStatus.DEACTIVATED);
    await this.sessions.revokeAllForUser(userId);
  }
}
