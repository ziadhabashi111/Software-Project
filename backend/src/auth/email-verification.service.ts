import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { corsOrigin } from '../config/cors';
import { fieldError } from '../common/validation/validation-errors';
import { MailService } from '../mail/mail.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { EmailTokenPurpose } from './email-tokens/email-token.schema';
import { EmailTokenService } from './email-tokens/email-token.service';

/** ACC-02: a verification link works for 24 hours. */
export const VERIFICATION_LINK_TTL_HOURS = 24;
export const VERIFICATION_LINK_TTL_MS =
  VERIFICATION_LINK_TTL_HOURS * 60 * 60 * 1000;

/**
 * ACC-02: email verification. A new user gets a link by email; opening it
 * marks the address as theirs. Whether booking is blocked until then is a
 * separate switch (`EMAIL_VERIFICATION_REQUIRED`, see `VerifiedEmailGuard`).
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: EmailTokenService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Emails a verification link. Never throws: registration must not fail
   * because a mail server is down, and the user can ask for a new link.
   */
  async send(user: Pick<UserDocument, 'id' | 'name' | 'email'>): Promise<void> {
    try {
      const token = await this.tokens.issue(
        user.id,
        EmailTokenPurpose.EMAIL_VERIFICATION,
        VERIFICATION_LINK_TTL_MS,
      );
      const link = `${corsOrigin(this.config)}/verify-email?token=${encodeURIComponent(token)}`;
      await this.mail.send({
        to: user.email,
        subject: 'Verify your email address',
        text: [
          `Hello ${user.name},`,
          '',
          `Open this link within ${VERIFICATION_LINK_TTL_HOURS} hours to verify your email address:`,
          link,
          '',
          'If you did not create an account, ignore this email.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(
        'Could not send a verification email',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Uses a verification link. An invalid, expired or used link is a 400 on `token`. */
  async verify(token: string): Promise<void> {
    const userId = await this.tokens.consume(
      token,
      EmailTokenPurpose.EMAIL_VERIFICATION,
    );
    if (!userId) {
      throw fieldError(
        'token',
        'This verification link is invalid or has expired',
      );
    }
    await this.users.markEmailVerified(userId);
  }

  /** Sends a new link to the logged-in user, unless the address is already verified. */
  async resend(userId: string): Promise<{ alreadyVerified: boolean }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Not logged in');
    if (user.emailVerified) return { alreadyVerified: true };
    await this.send(user);
    return { alreadyVerified: false };
  }
}
