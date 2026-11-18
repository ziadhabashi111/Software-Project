import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NOTIFICATION_SERVICE } from './notification.service.interface';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/**
 * Owner: Ziad Mohannad
 * Requirements: GEN-01
 * Add controllers, services, schemas/ and dto/ in this folder.
 */
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
  ],
  exports: [NOTIFICATION_SERVICE],
})
export class NotificationsModule {}
