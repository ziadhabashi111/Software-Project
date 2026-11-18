import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AdminAccountsService } from './admin-accounts.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminModerationService } from './admin-moderation.service';
import { AdminProvidersService } from './admin-providers.service';
import { AdminController } from './admin.controller';
import { BookingSources } from './booking-sources';
import { ContentModerators } from './content-moderators';
import { ProviderDirectory } from './provider-directory';
import { ReportDirectory } from './report-source';

/**
 * Owner: Habashi
 * Requirements: ACC-07a, ACC-13..17, GEN-07, GEN-09 (admin side), GEN-10
 *
 * Accounts, moderators, providers, the booking overview, reports, content
 * moderation and the audit trail. Other modules plug in through hooks
 * (import this module and inject them): `ProviderDirectory` (airlines,
 * hotels), `BookingSources` (flight and hotel bookings), `ReportDirectory`
 * (the report module), `ContentModerators` (posts, comments, reviews,
 * itineraries) and the optional `ADMIN_NOTIFIER` token (notifications).
 */
@Module({
  imports: [UsersModule, AuditModule],
  controllers: [AdminController],
  providers: [
    AdminAccountsService,
    AdminProvidersService,
    AdminBookingsService,
    AdminModerationService,
    AdminAuditService,
    ProviderDirectory,
    BookingSources,
    ReportDirectory,
    ContentModerators,
  ],
  exports: [
    ProviderDirectory,
    BookingSources,
    ReportDirectory,
    ContentModerators,
  ],
})
export class AdminModule {}
