import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { PasswordService } from '../src/auth/password.service';
import { Role } from '../src/auth/auth.types';
import { AdminSeeder } from '../src/users/admin-seeder.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UserStatus } from '../src/users/user-status';
import { UsersService } from '../src/users/users.service';
import { createTestApp, TestApp } from './helpers/app';

describe('Seeded administrator (ACC-18, real MongoDB in memory)', () => {
  let ctx: TestApp;
  let seeder: AdminSeeder;
  let users: UsersService;
  let passwords: PasswordService;
  let userModel: Model<UserDocument>;

  beforeAll(async () => {
    ctx = await createTestApp();
    seeder = ctx.moduleRef.get(AdminSeeder);
    users = ctx.moduleRef.get(UsersService);
    passwords = ctx.moduleRef.get(PasswordService);
    userModel = ctx.moduleRef.get<Model<UserDocument>>(
      getModelToken(User.name),
    );
  }, 180_000);

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await userModel.deleteMany({});
  });

  it('creates the admin with a hashed password', async () => {
    const result = await seeder.seed({
      email: 'Admin@Example.com',
      password: 'AdminPassw0rd',
    });
    expect(result).toBe('created');

    const admin = await userModel
      .findOne({ email: 'admin@example.com' })
      .select('+passwordHash');
    expect(admin?.role).toBe(Role.ADMIN);
    expect(admin?.status).toBe(UserStatus.ACTIVE);
    expect(admin?.mustChangePassword).toBe(false);
    expect(admin?.passwordHash).not.toContain('AdminPassw0rd');
  });

  it('is safe to run twice and never overwrites the existing admin', async () => {
    await seeder.seed({
      email: 'admin@example.com',
      password: 'AdminPassw0rd',
    });
    const before = await userModel
      .findOne({ email: 'admin@example.com' })
      .select('+passwordHash');

    const again = await seeder.seed({
      email: 'admin@example.com',
      password: 'DifferentPassw0rd',
    });
    expect(again).toBe('exists');
    expect(await userModel.countDocuments({ role: Role.ADMIN })).toBe(1);

    const after = await userModel
      .findOne({ email: 'admin@example.com' })
      .select('+passwordHash');
    expect(after?.passwordHash).toBe(before?.passwordHash);
  });

  it('lets the seeded admin log in', async () => {
    await seeder.seed({
      email: 'admin@example.com',
      password: 'AdminPassw0rd',
    });
    const res = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPassw0rd' })
      .expect(200);
    expect((res.body as { user: { role: string } }).user.role).toBe('admin');
  });

  it('refuses to turn an existing non-admin account into the admin', async () => {
    await users.create({
      name: 'Regular',
      email: 'admin@example.com',
      passwordHash: await passwords.hash('RegularPassw0rd'),
    });
    await expect(
      seeder.seed({ email: 'admin@example.com', password: 'AdminPassw0rd' }),
    ).rejects.toThrow(/not an administrator/i);
  });

  it('rejects a password that breaks the password rules', async () => {
    await expect(
      seeder.seed({ email: 'admin@example.com', password: 'weak' }),
    ).rejects.toThrow(/password/i);
    expect(await userModel.countDocuments({})).toBe(0);
  });

  it('rejects a missing or placeholder email', async () => {
    await expect(
      seeder.seed({ email: '<admin-email>', password: 'AdminPassw0rd' }),
    ).rejects.toThrow(/ADMIN_EMAIL/);
    await expect(
      seeder.seed({ email: '', password: 'AdminPassw0rd' }),
    ).rejects.toThrow(/ADMIN_EMAIL/);
  });
});
