import { ConflictException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { AuditLogService } from '../audit/audit-log.service';
import { Role } from '../auth/auth.types';
import type { PasswordService } from '../auth/password.service';
import type { SessionService } from '../auth/sessions/session.service';
import { UserStatus } from '../users/user-status';
import type { UsersService } from '../users/users.service';
import { AdminAccountsService } from './admin-accounts.service';
import type { ProviderDirectory } from './provider-directory';

const ADMIN = 'admin-1';
const TARGET = 'user-1';
/** Stands in for the transaction's MongoDB session. */
const SESSION = { id: 'session' };

function userDoc(status: UserStatus) {
  return {
    id: TARGET,
    name: 'Test User',
    email: 'user@example.com',
    role: Role.USER,
    status,
    mustChangePassword: false,
    createdAt: new Date('2026-11-01T00:00:00Z'),
  };
}

function setup(status: UserStatus, withNotifier = true) {
  const users = {
    findById: jest.fn().mockResolvedValue(userDoc(status)),
    transitionStatus: jest
      .fn()
      .mockImplementation((_id, _from, to) =>
        Promise.resolve(userDoc(to as UserStatus)),
      ),
  };
  const sessions = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const notifier = { notify: jest.fn().mockResolvedValue(undefined) };
  const connection = {
    transaction: jest.fn((work: (session: unknown) => Promise<unknown>) =>
      work(SESSION),
    ),
  };
  const service = new AdminAccountsService(
    users as unknown as UsersService,
    {} as PasswordService,
    sessions as unknown as SessionService,
    audit as unknown as AuditLogService,
    {} as ProviderDirectory,
    connection as unknown as Connection,
    withNotifier ? notifier : undefined,
  );
  return { service, users, sessions, audit, notifier };
}

describe('AdminAccountsService notifications (GEN-01)', () => {
  it('tells the account owner, and only them, when it is suspended', async () => {
    const { service, notifier } = setup(UserStatus.ACTIVE);
    await service.suspend(ADMIN, TARGET);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    const [recipients, notification] = notifier.notify.mock.calls[0] as [
      string[],
      { type: string; message: string },
    ];
    expect(recipients).toEqual([TARGET]);
    expect(notification.type).toBe('ACCOUNT_SUSPENDED');
    expect(notification.message).toContain('suspended');
  });

  it('tells the account owner when it is reactivated', async () => {
    const { service, notifier } = setup(UserStatus.SUSPENDED);
    await service.reactivate(ADMIN, TARGET);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    const [recipients, notification] = notifier.notify.mock.calls[0] as [
      string[],
      { type: string; message: string },
    ];
    expect(recipients).toEqual([TARGET]);
    expect(notification.type).toBe('ACCOUNT_REACTIVATED');
  });

  it('still suspends, signs out and audits when the notification fails', async () => {
    const { service, notifier, sessions, audit } = setup(UserStatus.ACTIVE);
    notifier.notify.mockRejectedValue(new Error('notifications down'));
    const result = await service.suspend(ADMIN, TARGET);
    expect(result.status).toBe(UserStatus.SUSPENDED);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(TARGET, SESSION);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('works when no notifier is provided', async () => {
    const { service } = setup(UserStatus.ACTIVE, false);
    await expect(service.suspend(ADMIN, TARGET)).resolves.toMatchObject({
      status: UserStatus.SUSPENDED,
    });
  });

  it('sends nothing when the suspension is rejected', async () => {
    const { service, notifier } = setup(UserStatus.SUSPENDED);
    await expect(service.suspend(ADMIN, TARGET)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('sends nothing when the account changed in the meantime', async () => {
    const { service, users, notifier } = setup(UserStatus.ACTIVE);
    users.transitionStatus.mockResolvedValue(null);
    await expect(service.suspend(ADMIN, TARGET)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
