import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit-action';
import { AuditLogService } from '../audit/audit-log.service';
import { Role } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/sessions/session.service';
import { Paginated, skipFor, toPage } from '../common/pagination/pagination';
import { fieldError } from '../common/validation/validation-errors';
import { toProfile, UserProfile } from '../users/user-profile';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import { ADMIN_NOTIFIER } from './admin-notifier';
import type { AdminNotifier } from './admin-notifier';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsQueryDto } from './dto/list-accounts.dto';
import { ProviderDirectory, ProviderType } from './provider-directory';

/** Admins and regular users and moderators; only the last two can be managed here. */
const MANAGEABLE_ROLES = [
  Role.USER,
  Role.AIRLINE_MODERATOR,
  Role.HOTEL_MODERATOR,
];

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/** ACC-07a, ACC-13, ACC-14, ACC-15 (moderators), ACC-16. */
@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger(AdminAccountsService.name);

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditLogService,
    private readonly providers: ProviderDirectory,
    @Optional()
    @Inject(ADMIN_NOTIFIER)
    private readonly notifier?: AdminNotifier,
  ) {}

  /** ACC-14 */
  async list(query: ListAccountsQueryDto): Promise<Paginated<UserProfile>> {
    const { items, total } = await this.users.findPage(
      {
        ...(query.search ? { search: query.search } : {}),
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      { skip: skipFor(query), limit: query.limit },
    );
    return toPage(items.map(toProfile), total, query);
  }

  /** ACC-13 */
  async createModerator(
    adminId: string,
    dto: CreateModeratorDto,
  ): Promise<UserProfile> {
    const type =
      dto.role === Role.AIRLINE_MODERATOR
        ? ProviderType.AIRLINE
        : ProviderType.HOTEL;
    const handler = this.providers.get(type);
    if (!handler) throw providerUnavailable(type);
    if (!(await handler.exists(dto.providerId))) {
      throw fieldError('providerId', `${capitalise(type)} not found`);
    }
    if (await this.users.findByEmail(dto.email)) throw emailTaken();

    let created;
    try {
      created = await this.users.create({
        name: dto.name,
        email: dto.email,
        passwordHash: await this.passwords.hash(dto.temporaryPassword),
        role: dto.role,
        providerId: dto.providerId,
        mustChangePassword: true,
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw emailTaken();
      throw error;
    }

    await this.audit.log({
      actorId: adminId,
      action: AuditAction.MODERATOR_CREATED,
      targetType: 'user',
      targetId: created.id,
      details: { role: dto.role, providerId: dto.providerId },
    });
    return toProfile(created);
  }

  /**
   * ACC-07a: the account is signed out everywhere, any login lock is cleared
   * and the next login must set a new password. The password is never logged.
   */
  async resetPassword(
    adminId: string,
    targetId: string,
    temporaryPassword: string,
  ): Promise<void> {
    await this.loadManageable(targetId);
    await this.users.setTemporaryPassword(
      targetId,
      await this.passwords.hash(temporaryPassword),
    );
    await this.sessions.revokeAllForUser(targetId);
    await this.audit.log({
      actorId: adminId,
      action: AuditAction.PASSWORD_RESET,
      targetType: 'user',
      targetId,
    });
  }

  /** ACC-15 (moderators) and ACC-16 (users): cannot log in; bookings stay valid. */
  async suspend(adminId: string, targetId: string): Promise<UserProfile> {
    const target = await this.loadManageable(targetId);
    if (target.status === UserStatus.SUSPENDED) {
      throw new ConflictException('The account is already suspended');
    }
    if (target.status !== UserStatus.ACTIVE) {
      throw new ConflictException(
        'The account was deactivated by its owner and cannot be suspended',
      );
    }
    const updated = await this.users.transitionStatus(
      targetId,
      UserStatus.ACTIVE,
      UserStatus.SUSPENDED,
      MANAGEABLE_ROLES,
    );
    if (!updated) {
      throw new ConflictException('The account changed, please try again');
    }
    await this.sessions.revokeAllForUser(targetId);
    await this.audit.log({
      actorId: adminId,
      action: AuditAction.ACCOUNT_SUSPENDED,
      targetType: 'user',
      targetId,
      details: { role: updated.role },
    });
    await this.notifyAccount(
      targetId,
      'ACCOUNT_SUSPENDED',
      'Your account was suspended by an administrator. You cannot log in until it is reactivated. Your existing confirmed bookings stay valid.',
    );
    return toProfile(updated);
  }

  async reactivate(adminId: string, targetId: string): Promise<UserProfile> {
    const target = await this.loadManageable(targetId);
    if (target.status === UserStatus.ACTIVE) {
      throw new ConflictException('The account is not suspended');
    }
    if (target.status !== UserStatus.SUSPENDED) {
      throw new ConflictException(
        'The account was deactivated by its owner and cannot be reactivated here',
      );
    }
    const updated = await this.users.transitionStatus(
      targetId,
      UserStatus.SUSPENDED,
      UserStatus.ACTIVE,
      MANAGEABLE_ROLES,
    );
    if (!updated) {
      throw new ConflictException('The account changed, please try again');
    }
    await this.audit.log({
      actorId: adminId,
      action: AuditAction.ACCOUNT_REACTIVATED,
      targetType: 'user',
      targetId,
      details: { role: updated.role },
    });
    await this.notifyAccount(
      targetId,
      'ACCOUNT_REACTIVATED',
      'Your account was reactivated. You can log in again.',
    );
    return toProfile(updated);
  }

  /**
   * GEN-01: tells the account's owner about a suspension or reactivation. A
   * failure is logged and never undoes the status change.
   */
  private async notifyAccount(
    userId: string,
    type: 'ACCOUNT_SUSPENDED' | 'ACCOUNT_REACTIVATED',
    message: string,
  ): Promise<void> {
    if (!this.notifier) return;
    try {
      await this.notifier.notify([userId], { type, message });
    } catch (error) {
      this.logger.error(
        `Could not send ${type} to user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** 404 when it does not exist, 403 for administrators (never managed through the API). */
  private async loadManageable(id: string) {
    const target = await this.users.findById(id);
    if (!target) throw new NotFoundException('Account not found');
    if (!MANAGEABLE_ROLES.includes(target.role)) {
      throw new ForbiddenException(
        'Administrator accounts cannot be changed here',
      );
    }
    return target;
  }
}

function emailTaken(): HttpException {
  return fieldError('email', 'Email is already registered', 409);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function providerUnavailable(type: ProviderType): HttpException {
  return new ServiceUnavailableException({
    statusCode: 503,
    error: 'Service Unavailable',
    message: `Managing ${type}s is not available yet`,
    code: 'PROVIDER_MODULE_UNAVAILABLE',
  });
}
