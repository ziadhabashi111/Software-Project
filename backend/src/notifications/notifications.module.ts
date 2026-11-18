import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ADMIN_NOTIFIER } from '../admin/admin-notifier';
import { AdminNotifierAdapter } from './admin-notifier.adapter';
import { NOTIFICATION_SERVICE } from './notification.service.interface';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/**
 * Owner: Ziad Mohannad
 * Requirements: GEN-01 (and the ACC-15 admin notifier adapter)
 *
 * Global because notifications are a cross-cutting shared service: flights
 * (FLT-05, FLT-06), bookings and admin (ACC-15) inject NOTIFICATION_SERVICE /
 * ADMIN_NOTIFIER without importing this module. It is registered once, in
 * AppModule.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_SERVICE, useExisting: NotificationsService },
    AdminNotifierAdapter,
    { provide: ADMIN_NOTIFIER, useExisting: AdminNotifierAdapter },
  ],
  exports: [NOTIFICATION_SERVICE, ADMIN_NOTIFIER],
})
export class NotificationsModule {}
