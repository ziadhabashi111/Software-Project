import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Owner: Habashi
 * Requirements: GEN-01-B (used by ACC-02, ACC-07)
 *
 * Email sending. Import `MailModule` and inject `MailService`.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
