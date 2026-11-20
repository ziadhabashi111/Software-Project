import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EmailTokenPurpose } from './email-tokens/email-token.schema';
import type { EmailTokenService } from './email-tokens/email-token.service';
import {
  EmailVerificationService,
  VERIFICATION_LINK_TTL_MS,
} from './email-verification.service';
import type { MailService } from '../mail/mail.service';
import type { UsersService } from '../users/users.service';

const USER_ID = '665f1c2a9b1e8a0012345670';

/** What the service hands to `MailService.send`. */
interface SentMail {
  to: string;
  subject: string;
  text: string;
}

function userDoc(emailVerified = false) {
  return {
    id: USER_ID,
    name: 'Sara',
    email: 'sara@example.com',
    emailVerified,
  };
}

function build(options: { user?: ReturnType<typeof userDoc> | null } = {}) {
  const user = options.user === undefined ? userDoc() : options.user;
  const users = {
    findById: jest.fn().mockResolvedValue(user),
    markEmailVerified: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    issue: jest.fn().mockResolvedValue('VERIFY-TOKEN'),
    consume: jest.fn().mockResolvedValue(USER_ID),
  };
  const mail = {
    send: jest.fn<Promise<void>, [SentMail]>().mockResolvedValue(undefined),
  };
  const values: Record<string, string> = {
    FRONTEND_URL: 'https://app.example.test',
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  const service = new EmailVerificationService(
    users as unknown as UsersService,
    tokens as unknown as EmailTokenService,
    mail as unknown as MailService,
    config,
  );
  return { service, users, tokens, mail };
}

describe('EmailVerificationService (ACC-02)', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('send', () => {
    it('emails a 24-hour verification link', async () => {
      const { service, tokens, mail } = build();
      await service.send(userDoc());

      expect(VERIFICATION_LINK_TTL_MS).toBe(24 * 60 * 60 * 1000);
      expect(tokens.issue).toHaveBeenCalledWith(
        USER_ID,
        EmailTokenPurpose.EMAIL_VERIFICATION,
        VERIFICATION_LINK_TTL_MS,
      );
      const sent = mail.send.mock.calls[0][0];
      expect(sent.to).toBe('sara@example.com');
      expect(sent.text).toContain(
        'https://app.example.test/verify-email?token=VERIFY-TOKEN',
      );
      expect(sent.text).toContain('24 hours');
    });

    // Registration must succeed even when the mail server is down; the user
    // can ask for a new link afterwards.
    it('never throws when the email cannot be sent', async () => {
      const { service, mail } = build();
      mail.send.mockRejectedValueOnce(new Error('connection refused'));
      await expect(service.send(userDoc() as never)).resolves.toBeUndefined();
      expect(logError).toHaveBeenCalled();
    });

    it('never throws when the link cannot be created either', async () => {
      const { service, tokens, mail } = build();
      tokens.issue.mockRejectedValueOnce(new Error('db down'));
      await expect(service.send(userDoc() as never)).resolves.toBeUndefined();
      expect(mail.send).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('marks the link’s account as verified', async () => {
      const { service, tokens, users } = build();
      await service.verify('VERIFY-TOKEN');
      expect(tokens.consume).toHaveBeenCalledWith(
        'VERIFY-TOKEN',
        EmailTokenPurpose.EMAIL_VERIFICATION,
      );
      expect(users.markEmailVerified).toHaveBeenCalledWith(USER_ID);
    });

    it('rejects an invalid, expired or already used link with a field error', async () => {
      const { service, tokens, users } = build();
      tokens.consume.mockResolvedValueOnce(null);
      const error = await service.verify('bad').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).toContain('token');
      expect(users.markEmailVerified).not.toHaveBeenCalled();
    });
  });

  describe('resend', () => {
    it('sends a new link to an unverified user', async () => {
      const { service, mail } = build({ user: userDoc(false) });
      await expect(service.resend(USER_ID)).resolves.toEqual({
        alreadyVerified: false,
      });
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    // Nothing to do, and no pointless email.
    it('sends nothing to a user who is already verified', async () => {
      const { service, tokens, mail } = build({ user: userDoc(true) });
      await expect(service.resend(USER_ID)).resolves.toEqual({
        alreadyVerified: true,
      });
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('answers 401 when the account no longer exists', async () => {
      const { service } = build({ user: null });
      await expect(service.resend(USER_ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
