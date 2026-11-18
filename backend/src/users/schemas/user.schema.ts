import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Role } from '../../auth/auth.types';
import { UserStatus } from '../user-status';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  /** Stored lower-case; unique. */
  @Prop({
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email!: string;

  /** Salted hash only (GEN-13). Excluded from queries unless asked for. */
  @Prop({ type: String, required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, enum: Object.values(Role), default: Role.USER })
  role!: Role;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @Prop({ type: String })
  phone?: string;

  @Prop({ type: String, uppercase: true })
  preferredCurrency?: string;

  /** Airline or hotel a moderator manages (exactly one). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  providerId?: Types.ObjectId;

  /** Consecutive failed logins (ACC-05). */
  @Prop({ type: Number, default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date })
  lockUntil?: Date;

  /** Temporary password: must be changed before anything else (ACC-07a, ACC-13). */
  @Prop({ type: Boolean, default: false })
  mustChangePassword!: boolean;

  /** When the terms and privacy consent was given at registration (ACC-01). */
  @Prop({ type: Date })
  consentAcceptedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
