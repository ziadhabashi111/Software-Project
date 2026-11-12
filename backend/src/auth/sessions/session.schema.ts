import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

/** One login on one device. Lets us revoke it and expire it after inactivity. */
@Schema({ timestamps: true })
export class Session {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  /** The id of the refresh token that is currently valid (rotates on every refresh). */
  @Prop({ type: String, required: true })
  refreshJti!: string;

  @Prop({ type: Date, required: true })
  lastActivityAt!: Date;

  /** Absolute end of the session (refresh token lifetime). */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  revokedAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
// MongoDB removes the document once the session can no longer be used.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
