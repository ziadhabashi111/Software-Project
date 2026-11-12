import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import { LOCK_DURATION_MS, MAX_FAILED_LOGINS } from '../auth/login-policy';
import { User, UserDocument } from './schemas/user.schema';
import { UserStatus } from './user-status';

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
  role?: Role;
  status?: UserStatus;
  providerId?: string;
  mustChangePassword?: boolean;
  consentAcceptedAt?: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly model: Model<UserDocument>,
  ) {}

  create(input: NewUser): Promise<UserDocument> {
    const { providerId, ...rest } = input;
    return this.model.create({
      ...rest,
      ...(providerId ? { providerId: new Types.ObjectId(providerId) } : {}),
    });
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.model.findById(id).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.model.findOne({ email: email.toLowerCase() }).exec();
  }

  /** Includes the password hash. Only for login and change-password. */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.model
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.model.findById(id).select('+passwordHash').exec();
  }

  /**
   * Counts a failed login (ACC-05). On the 5th consecutive failure the
   * account is locked for 15 minutes and the counter starts again.
   */
  async recordFailedLogin(
    userId: string,
  ): Promise<{ locked: boolean; lockUntil?: Date }> {
    const updated = await this.model
      .findByIdAndUpdate(
        userId,
        { $inc: { failedLoginAttempts: 1 } },
        { new: true },
      )
      .exec();
    if (updated && updated.failedLoginAttempts >= MAX_FAILED_LOGINS) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
      await this.model
        .updateOne({ _id: userId }, { lockUntil, failedLoginAttempts: 0 })
        .exec();
      return { locked: true, lockUntil };
    }
    return { locked: false };
  }

  /** A successful login resets the counter (ACC-05). */
  async resetLoginFailures(userId: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: userId },
        { failedLoginAttempts: 0, $unset: { lockUntil: 1 } },
      )
      .exec();
  }

  async setPassword(
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    await this.model
      .updateOne({ _id: userId }, { passwordHash, mustChangePassword })
      .exec();
  }
}
