import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../auth/auth.types';
import {
  PASSWORD_REGEX,
  PASSWORD_RULE_MESSAGE,
  PasswordService,
} from '../auth/password.service';
import { UsersService } from './users.service';

export interface AdminSeedInput {
  email: string;
  password: string;
}

/**
 * ACC-18: administrator accounts are created by seeding, never by
 * registration. Safe to run any number of times.
 */
@Injectable()
export class AdminSeeder {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
  ) {}

  /** Reads ADMIN_EMAIL and ADMIN_PASSWORD from the environment. */
  seedFromEnv(): Promise<'created' | 'exists'> {
    return this.seed({
      email: this.config.get<string>('ADMIN_EMAIL', ''),
      password: this.config.get<string>('ADMIN_PASSWORD', ''),
    });
  }

  async seed(input: AdminSeedInput): Promise<'created' | 'exists'> {
    const email = input.email.trim().toLowerCase();
    if (!email || email.startsWith('<') || !email.includes('@')) {
      throw new Error('ADMIN_EMAIL is missing or still a placeholder');
    }
    if (!PASSWORD_REGEX.test(input.password)) {
      throw new Error(`ADMIN_PASSWORD is invalid: ${PASSWORD_RULE_MESSAGE}`);
    }

    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (existing.role !== Role.ADMIN) {
        throw new Error(
          `${email} already exists and is not an administrator; choose another ADMIN_EMAIL`,
        );
      }
      return 'exists';
    }

    await this.users.create({
      name: 'Administrator',
      email,
      passwordHash: await this.passwords.hash(input.password),
      role: Role.ADMIN,
    });
    return 'created';
  }
}
