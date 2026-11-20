import { BadRequestException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Role } from './auth.types';
import { EmailTokenPurpose } from './email-tokens/email-token.schema';
import type { EmailTokenService } from './email-tokens/email-token.service';
import type { MailService } from '../mail/mail.service';
import type { PasswordService } from './password.service';
import {
  PasswordResetService,
  RESET_LINK_TTL_MS,
} from './password-reset.service';
import type { SessionService } from './sessions/session.service';
import { UserStatus } from '../users/user-status';
import type { UsersService } from '../users/users.service';

const USER_ID = '665f1c2a9b1e8a0012345670';

/** What the service hands to `MailService.send`. */
interface SentMail {
  to: string;
  subject: string;
  text: string;
}

function userDoc(status: UserStatus = UserStatus.ACTIVE) {
  return {
    id: USER_ID,
    name: 'Sara',
    email: 'sara@example.com',
    role: Role.USER,
    status,
  };
}

/** Lets fire-and-forget work (the email) finish before the test looks at it. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function build(options: { user?: ReturnType<typeof userDoc> | null } = {}) {
  const user = options.user === undefined ? userDoc() : options.user;
  const users = {
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    resetPassword: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    issue: jest.fn().mockResolvedValue('TOKEN-123'),
    consume: jest.fn().mockResolvedValue(USER_ID),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed') };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    send: jest.fn<Promise<void>, [SentMail]>().mockResolvedValue(undefined),
  };
  const values: Record<string, string> = {
    FRONTEND_URL: 'https://app.example.test/',
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  const service = new PasswordResetService(
    users as unknown as UsersService,
    tokens as unknown as EmailTokenService,
    passwords as unknown as PasswordService,
    sessions as unknown as SessionService,
    mail as unknown as MailService,
    config,
  );
  return { service, users, tokens, passwords, sessions, mail };
}

describe('PasswordResetService.request (ACC-07)', () => {
  let logError: jest.SpyInstance;

  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('emails a 30-minute reset link to an active account', async () => {
    const { service, tokens, mail } = build();
    await service.request('sara@example.com');
    await flush();

    expect(RESET_LINK_TTL_MS).toBe(30 * 60 * 1000);
    expect(tokens.issue).toHaveBeenCalledWith(
      USER_ID,
      EmailTokenPurpose.PASSWORD_RESET,
      RESET_LINK_TTL_MS,
    );
    expect(mail.send).toHaveBeenCalledTimes(1);
    const sent = mail.send.mock.calls[0][0];
    expect(sent.to).toBe('sara@example.com');
    expect(sent.text).toContain(
      'https://app.example.test/reset-password?token=TOKEN-123',
    );
    expect(sent.text).toContain('30 minutes');
  });

  // The answer must not tell an attacker which emails have an account.
  it('does nothing, and says nothing, for an unknown email', async () => {
    const { service, tokens, mail } = build({ user: null });
    await expect(
      service.request('nobody@example.com'),
    ).resolves.toBeUndefined();
    await flush();
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it.each([UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    'sends nothing to a %s account',
    async (status) => {
      const { service, tokens, mail } = build({ user: userDoc(status) });
      await service.request('sara@example.com');
      await flush();
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    },
  );

  // A broken mail server must look the same to the caller as a working one.
  it('does not fail, only logs, when the email cannot be sent', async () => {
    const { service, mail } = build();
    mail.send.mockRejectedValueOnce(new Error('connection refused'));
    await expect(service.request('sara@example.com')).resolves.toBeUndefined();
    await flush();
    expect(logError).toHaveBeenCalled();
  });

  // If the answer waited for the email, a slow send would reveal a real account.
  it('answers without waiting for the email to be sent', async () => {
    const { service, mail } = build();
    mail.send.mockReturnValueOnce(new Promise(() => undefined)); // never ends
    await expect(service.request('sara@example.com')).resolves.toBeUndefined();
  });
});

describe('PasswordResetService.reset (ACC-07)', () => {
  it('sets the new password and ends every session of the user', async () => {
    const { service, tokens, passwords, users, sessions } = build();
    await service.reset('TOKEN-123', 'NewPassw0rd');

    expect(tokens.consume).toHaveBeenCalledWith(
      'TOKEN-123',
      EmailTokenPurpose.PASSWORD_RESET,
    );
    expect(passwords.hash).toHaveBeenCalledWith('NewPassw0rd');
    expect(users.resetPassword).toHaveBeenCalledWith(USER_ID, 'hashed');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('rejects an invalid, expired or already used link with a field error', async () => {
    const { service, tokens, passwords, users } = build();
    tokens.consume.mockResolvedValueOnce(null);
    const error = await service
      .reset('bad', 'NewPassw0rd')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((error as BadRequestException).getResponse()),
    ).toContain('token');
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(users.resetPassword).not.toHaveBeenCalled();
  });

  // A link made before the account was suspended must not unlock it again.
  it('rejects a link whose account is suspended or gone, leaving the password alone', async () => {
    const suspended = build({ user: userDoc(UserStatus.SUSPENDED) });
    await expect(
      suspended.service.reset('t', 'NewPassw0rd'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(suspended.users.resetPassword).not.toHaveBeenCalled();

    const gone = build({ user: null });
    await expect(gone.service.reset('t', 'NewPassw0rd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(gone.users.resetPassword).not.toHaveBeenCalled();
  });
});
