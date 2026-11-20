import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EmailTokenDocument = HydratedDocument<EmailToken>;

/** What an emailed link is for. */
export enum EmailTokenPurpose {
  /** ACC-07: reset a forgotten password. */
  PASSWORD_RESET = 'password_reset',
  /** ACC-02: prove the email address is the user's. */
  EMAIL_VERIFICATION = 'email_verification',
}

/**
 * ACC-02, ACC-07: the one live emailed link of a user for a purpose. Only the
 * SHA-256 hash of the token is stored, never the token itself, so a copy of
 * the database cannot be used to reset a password. A newer link overwrites the
 * older one (one document per user and purpose), and the document is deleted
 * when the link is used or when it expires.
 */
@Schema({
  collection: 'email_tokens',
  timestamps: { createdAt: true, updatedAt: false },
})
export class EmailToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  user!: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(EmailTokenPurpose),
    required: true,
  })
  purpose!: EmailTokenPurpose;

  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const EmailTokenSchema = SchemaFactory.createForClass(EmailToken);

// At most one live link per user and purpose: a newer request replaces it.
EmailTokenSchema.index({ user: 1, purpose: 1 }, { unique: true });
// MongoDB removes expired links by itself.
EmailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
