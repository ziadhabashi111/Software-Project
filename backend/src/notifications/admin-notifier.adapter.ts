import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminNotification, AdminNotifier } from '../admin/admin-notifier';
import { NOTIFICATION_SERVICE } from './notification.service.interface';
import type { NotificationService } from './notification.service.interface';

/**
 * ACC-15: provides `ADMIN_NOTIFIER` for the admin module. Sends the same
 * in-app notification (e.g. PROVIDER_DEACTIVATED) to every affected user:
 * the provider's moderators and travellers with confirmed bookings.
 * One failed recipient does not stop the others.
 */
@Injectable()
export class AdminNotifierAdapter implements AdminNotifier {
  private readonly logger = new Logger(AdminNotifierAdapter.name);

  constructor(
    @Inject(NOTIFICATION_SERVICE)
    private readonly notifications: NotificationService,
  ) {}

  async notify(
    userIds: string[],
    notification: AdminNotification,
  ): Promise<void> {
    const recipients = [...new Set(userIds)];
    const results = await Promise.allSettled(
      recipients.map((userId) =>
        this.notifications.notify(
          userId,
          notification.type,
          notification.message,
        ),
      ),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.error(
        `Could not deliver ${notification.type} to ${failed} of ${recipients.length} users`,
      );
    }
  }
}
