import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit-action';
import { AuditLogService } from '../audit/audit-log.service';
import { UsersService } from '../users/users.service';
import { providerUnavailable } from './admin-accounts.service';
import { ADMIN_NOTIFIER } from './admin-notifier';
import type { AdminNotifier } from './admin-notifier';
import { ProviderDirectory, ProviderType } from './provider-directory';

export interface ProviderState {
  id: string;
  type: ProviderType;
  name: string;
  active: boolean;
  /** False when the provider was already in the requested state. */
  changed: boolean;
}

/** ACC-15: deactivate and reactivate a hotel or airline. */
@Injectable()
export class AdminProvidersService {
  private readonly logger = new Logger(AdminProvidersService.name);

  constructor(
    private readonly directory: ProviderDirectory,
    private readonly users: UsersService,
    private readonly audit: AuditLogService,
    @Optional()
    @Inject(ADMIN_NOTIFIER)
    private readonly notifier?: AdminNotifier,
  ) {}

  async setActive(
    adminId: string,
    type: ProviderType,
    id: string,
    active: boolean,
  ): Promise<ProviderState> {
    const handler = this.directory.get(type);
    if (!handler) throw providerUnavailable(type);

    const change = await handler.setActive(id, active);
    if (!change) throw new NotFoundException(`${type} not found`);

    if (change.changed) {
      await this.auditOrUndo(adminId, type, id, active, change.name);
      await this.notifyAffected(type, id, change, active);
    }
    return { id, type, name: change.name, active, changed: change.changed };
  }

  /**
   * GEN-07: the change is made by the airline or hotel module, so it cannot
   * share a transaction with the audit record. If the record cannot be
   * written, the change is put back and the request fails, so no provider
   * change is left without its audit entry.
   */
  private async auditOrUndo(
    adminId: string,
    type: ProviderType,
    id: string,
    active: boolean,
    name: string,
  ): Promise<void> {
    try {
      await this.audit.log({
        actorId: adminId,
        action: active
          ? AuditAction.PROVIDER_REACTIVATED
          : AuditAction.PROVIDER_DEACTIVATED,
        targetType: type,
        targetId: id,
        details: { name },
      });
    } catch (error) {
      try {
        await this.directory.get(type)?.setActive(id, !active);
      } catch (undoError) {
        this.logger.error(
          `Could not undo the ${type} ${id} change after the audit failed`,
          undoError instanceof Error ? undoError.stack : String(undoError),
        );
      }
      throw error;
    }
  }

  /**
   * Tells the provider's moderators and the travellers with Confirmed
   * bookings. Best effort: the change is already saved and audited, so a
   * notification failure is logged and does not fail the request.
   */
  private async notifyAffected(
    type: ProviderType,
    id: string,
    change: { name: string; affectedUserIds?: string[] },
    active: boolean,
  ): Promise<void> {
    if (!this.notifier) return;
    try {
      const moderators = await this.users.findModeratorIdsByProvider(id);
      const recipients = [
        ...new Set([...moderators, ...(change.affectedUserIds ?? [])]),
      ];
      if (recipients.length === 0) return;
      await this.notifier.notify(recipients, {
        type: active ? 'PROVIDER_REACTIVATED' : 'PROVIDER_DEACTIVATED',
        message: active
          ? `The ${type} "${change.name}" is available again.`
          : `The ${type} "${change.name}" was deactivated by an administrator. Existing confirmed bookings stay valid.`,
      });
    } catch (error) {
      this.logger.error(
        `Could not send the ${type} notification`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
