import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { corsOrigin } from '../config/cors';
import { fieldError } from '../common/validation/validation-errors';
import { MailService } from '../mail/mail.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { UserStatus } from '../users/user-status';
import { UsersService } from '../users/users.service';
import { EmailTokenPurpose } from './email-tokens/email-token.schema';
import { EmailTokenService } from './email-tokens/email-token.service';
import { PasswordService } from './password.service';
import { SessionService } from './sessions/session.service';

/** ACC-07: a reset link works for 30 minutes. */
export const RESET_LINK_TTL_MINUTES = 30;
export const RESET_LINK_TTL_MS = RESET_LINK_TTL_MINUTES * 60 * 1000;

/**
 * ACC-07: forgot and reset password by email. The link is single-use, lasts
 * 30 minutes and is replaced by a newer request (see `EmailTokenService`).
 * Requesting a link never reveals whether the email has an account.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: EmailTokenService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sends a reset link when the email belongs to an active account, and does
   * nothing otherwise; the caller answers the same either way. The email is
   * sent in the background, so a slow mail server cannot show the difference
   * between a known and an unknown address.
   */
  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const token = await this.tokens.issue(
      user.id,
      EmailTokenPurpose.PASSWORD_RESET,
      RESET_LINK_TTL_MS,
    );
    void this.deliver(user, token);
  }

  /**
   * Sets the new password for the link's account and signs it out everywhere.
   * An invalid, expired or already used link, or an account that is no longer
   * active, is one 400 error.
   */
  async reset(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consume(
      token,
      EmailTokenPurpose.PASSWORD_RESET,
    );
    if (!userId) throw this.invalidLink();
    const user = await this.users.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE) throw this.invalidLink();

    await this.users.resetPassword(
      userId,
      await this.passwords.hash(newPassword),
    );
    await this.sessions.revokeAllForUser(userId);
  }

  private async deliver(user: UserDocument, token: string): Promise<void> {
    const link = `${corsOrigin(this.config)}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Reset your password',
        text: [
          `Hello ${user.name},`,
          '',
          `Open this link within ${RESET_LINK_TTL_MINUTES} minutes to choose a new password:`,
          link,
          '',
          'The link works once. If you did not ask for this, ignore this email: your password stays the same.',
        ].join('\n'),
      });
    } catch (error) {
      // Never shown to the caller: that would reveal the account exists.
      this.logger.error(
        'Could not send a password reset email',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private invalidLink() {
    return fieldError('token', 'This reset link is invalid or has expired');
  }
}
