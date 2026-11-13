import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminProvidersService } from './admin-providers.service';
import { AdminController } from './admin.controller';
import { BookingSources } from './booking-sources';
import { ProviderDirectory } from './provider-directory';

/**
 * Owner: Habashi
 * Requirements: ACC-07a, ACC-13..17, GEN-07, GEN-10
 *
 * Accounts, moderators, providers and the booking overview. Other modules
 * plug in through three hooks (import this module and inject them):
 * `ProviderDirectory` (airlines, hotels), `BookingSources` (flight and hotel
 * bookings) and the optional `ADMIN_NOTIFIER` token (notifications).
 */
@Module({
  imports: [UsersModule, AuditModule],
  controllers: [AdminController],
  providers: [
    AdminAccountsService,
    AdminProvidersService,
    AdminBookingsService,
    ProviderDirectory,
    BookingSources,
  ],
  exports: [ProviderDirectory, BookingSources],
})
export class AdminModule {}
