import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, QueryFilter, Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import { LOCK_DURATION_MS, MAX_FAILED_LOGINS } from '../auth/login-policy';
import { User, UserDocument } from './schemas/user.schema';
import { UserStatus } from './user-status';

/** Search text is matched literally, never as a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  create(input: NewUser, session?: ClientSession): Promise<UserDocument> {
    const { providerId, ...rest } = input;
    return new this.model({
      ...rest,
      ...(providerId ? { providerId: new Types.ObjectId(providerId) } : {}),
    }).save({ session });
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
   * ACC-05: claims one login attempt before the password is checked. Atomic,
   * so parallel requests cannot all slip past the lock: at most
   * MAX_FAILED_LOGINS attempts are claimed before the account locks. Returns
   * the attempt number, or null when the account is locked (or its last
   * allowed attempts are already in flight).
   */
  async claimLoginAttempt(
    userId: string,
    now: Date = new Date(),
  ): Promise<number | null> {
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: userId,
          failedLoginAttempts: { $lt: MAX_FAILED_LOGINS },
          $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
        },
        { $inc: { failedLoginAttempts: 1 } },
        { returnDocument: 'after' },
      )
      .exec();
    return updated ? updated.failedLoginAttempts : null;
  }

  /**
   * The claimed attempt had a wrong password. The one that used the last
   * allowed attempt locks the account for 15 minutes and starts the counter
   * again (ACC-05). True when the account is now locked.
   */
  async failLoginAttempt(userId: string, attempt: number): Promise<boolean> {
    if (attempt < MAX_FAILED_LOGINS) return false;
    await this.model
      .updateOne(
        { _id: userId },
        {
          lockUntil: new Date(Date.now() + LOCK_DURATION_MS),
          failedLoginAttempts: 0,
        },
      )
      .exec();
    return true;
  }

  /**
   * A correct password resets the counter (ACC-05), unless parallel wrong
   * attempts locked the account meanwhile: then false, and the login is
   * refused as locked.
   */
  async resetLoginFailures(
    userId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          _id: userId,
          $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
        },
        { failedLoginAttempts: 0, $unset: { lockUntil: 1 } },
      )
      .exec();
    return result.matchedCount === 1;
  }

  updateProfile(
    userId: string,
    patch: {
      name?: string;
      phone?: string | null;
      preferredCurrency?: string;
    },
  ): Promise<UserDocument | null> {
    // A null phone clears it (the only clearable profile field, ACC-09).
    const { phone, ...rest } = patch;
    const set =
      phone === null || phone === undefined ? rest : { ...rest, phone };
    return this.model
      .findByIdAndUpdate(
        userId,
        phone === null ? { $set: set, $unset: { phone: 1 } } : { $set: set },
        { new: true, runValidators: true },
      )
      .exec();
  }

  async setStatus(userId: string, status: UserStatus): Promise<void> {
    await this.model.updateOne({ _id: userId }, { status }).exec();
  }

  /**
   * Moves an account from one status to another only if it is still in the
   * `from` status and has one of `roles`, so two admins acting at once cannot
   * both succeed. Returns `null` when nothing matched.
   */
  transitionStatus(
    userId: string,
    from: UserStatus,
    to: UserStatus,
    roles: Role[],
    session?: ClientSession,
  ): Promise<UserDocument | null> {
    return this.model
      .findOneAndUpdate(
        { _id: userId, status: from, role: { $in: roles } },
        { status: to },
        { new: true, session },
      )
      .exec();
  }

  /** The admin account list (ACC-14): newest registrations first. */
  async findPage(
    filter: { search?: string; role?: Role; status?: UserStatus },
    page: { skip: number; limit: number },
  ): Promise<{ items: UserDocument[]; total: number }> {
    const query: QueryFilter<UserDocument> = {};
    if (filter.role) query.role = filter.role;
    if (filter.status) query.status = filter.status;
    if (filter.search) {
      const text = new RegExp(escapeRegExp(filter.search), 'i');
      query.$or = [{ name: text }, { email: text }];
    }
    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total };
  }

  findByIds(ids: string[]): Promise<UserDocument[]> {
    return this.model.find({ _id: { $in: ids } }).exec();
  }

  async findModeratorIdsByProvider(providerId: string): Promise<string[]> {
    const moderators = await this.model
      .find({
        providerId: new Types.ObjectId(providerId),
        role: { $in: [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR] },
      })
      .select('_id')
      .exec();
    return moderators.map((moderator) => moderator.id);
  }

  /** ACC-07a: a temporary password the account must replace at its next login. */
  async setTemporaryPassword(
    userId: string,
    passwordHash: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: userId },
        {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          $unset: { lockUntil: 1 },
        },
        { session },
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

  /**
   * ACC-07: the user chose a new password through the emailed link, so it is
   * a normal password (no forced change) and the account is no longer locked
   * from earlier failed logins.
   */
  async resetPassword(userId: string, passwordHash: string): Promise<void> {
    await this.model
      .updateOne(
        { _id: userId },
        {
          passwordHash,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          $unset: { lockUntil: 1 },
        },
      )
      .exec();
  }
}
