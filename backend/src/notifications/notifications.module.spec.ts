import { Inject, Injectable, Module, Optional } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ADMIN_NOTIFIER } from '../admin/admin-notifier';
import type { AdminNotifier } from '../admin/admin-notifier';
import { AdminNotifierAdapter } from './admin-notifier.adapter';
import { NOTIFICATION_SERVICE } from './notification.service.interface';
import type { NotificationService } from './notification.service.interface';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';

/**
 * Mirrors how FlightsService / FlightManagementService (FLT-05, FLT-06) and
 * AdminProvidersService (ACC-15) consume the tokens: @Optional() injection
 * from a module that does NOT import NotificationsModule.
 */
@Injectable()
class Consumer {
  constructor(
    @Optional()
    @Inject(NOTIFICATION_SERVICE)
    readonly notifications?: NotificationService,
    @Optional()
    @Inject(ADMIN_NOTIFIER)
    readonly adminNotifier?: AdminNotifier,
  ) {}
}

@Module({ providers: [Consumer] })
class ConsumerModule {}

describe('NotificationsModule wiring (GEN-01, FLT-05, FLT-06, ACC-15)', () => {
  it('gives the real services to a module that does not import it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [NotificationsModule, ConsumerModule],
    })
      .overrideProvider(getModelToken(Notification.name))
      .useValue({})
      .compile();

    const consumer = moduleRef.get(Consumer);
    expect(consumer.notifications).toBeInstanceOf(NotificationsService);
    expect(consumer.adminNotifier).toBeInstanceOf(AdminNotifierAdapter);
    // useExisting: one shared instance, no double registration.
    expect(consumer.notifications).toBe(moduleRef.get(NotificationsService));
    await moduleRef.close();
  });
});
