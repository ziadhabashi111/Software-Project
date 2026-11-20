import { ConflictException } from '@nestjs/common';
import { Role } from './auth.types';
import { AuthService } from './auth.service';
import type { EmailVerificationService } from './email-verification.service';
import type { PasswordService } from './password.service';
import type { SessionService } from './sessions/session.service';
import type { TokenService } from './token.service';
import { UserStatus } from '../users/user-status';
import type { UsersService } from '../users/users.service';

const dto = {
  name: '  Sara Ali  ',
  email: 'sara@example.com',
  password: 'Passw0rdOk',
  consent: true as const,
};

function createdUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '665f1c2a9b1e8a0012345670',
    name: 'Sara Ali',
    email: 'sara@example.com',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    emailVerified: false,
    createdAt: new Date('2026-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

function build(options: { existing?: boolean } = {}) {
  const user = createdUser();
  const users = {
    findByEmail: jest.fn().mockResolvedValue(options.existing ? user : null),
    create: jest.fn().mockResolvedValue(user),
  };
  const passwords = { hash: jest.fn().mockResolvedValue('hashed-password') };
  const verification = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    users as unknown as UsersService,
    {} as SessionService,
    passwords as unknown as PasswordService,
    {} as TokenService,
    verification as unknown as EmailVerificationService,
  );
  return { service, users, passwords, verification, user };
}

describe('AuthService.register (ACC-01, ACC-02)', () => {
  it('creates an unverified regular user with a hashed password and consent time', async () => {
    const { service, users } = build();
    await service.register(dto);

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sara Ali',
        email: 'sara@example.com',
        passwordHash: 'hashed-password',
        role: Role.USER,
        emailVerified: false,
        consentAcceptedAt: expect.any(Date) as Date,
      }),
    );
  });

  it('returns the profile, showing the email is not verified yet', async () => {
    const { service } = build();
    const profile = await service.register(dto);
    expect(profile).toMatchObject({
      email: 'sara@example.com',
      emailVerified: false,
    });
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('sends the verification email to the new user', async () => {
    const { service, verification, user } = build();
    await service.register(dto);
    expect(verification.send).toHaveBeenCalledTimes(1);
    expect(verification.send).toHaveBeenCalledWith(user);
  });

  // Registration must not wait for (or fail because of) the mail server.
  it('answers without waiting for the email to be sent', async () => {
    const { service, verification } = build();
    verification.send.mockReturnValueOnce(new Promise(() => undefined));
    await expect(service.register(dto)).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it('answers 409 and sends nothing when the email is already registered', async () => {
    const { service, users, verification } = build({ existing: true });
    await expect(service.register(dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(users.create).not.toHaveBeenCalled();
    expect(verification.send).not.toHaveBeenCalled();
  });

  // Two sign-ups with the same email at the same moment: the unique index
  // lets one through and the other gets the same 409.
  it('answers 409 and sends nothing when the unique index rejects a parallel sign-up', async () => {
    const { service, users, verification } = build();
    users.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: 11000 }),
    );
    await expect(service.register(dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(verification.send).not.toHaveBeenCalled();
  });
});
