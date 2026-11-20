import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { EmailToken, EmailTokenPurpose } from './email-token.schema';

/** Longest token we will even look up (real ones are 43 characters). */
const MAX_TOKEN_LENGTH = 200;

/** The value stored for a token: its SHA-256 hex, never the token itself. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * ACC-02, ACC-07: the emailed links. A token is 32 random bytes (so an
 * unsalted hash is enough), valid once, and for a limited time. Only the hash
 * is stored.
 */
@Injectable()
export class EmailTokenService {
  constructor(
    @InjectModel(EmailToken.name)
    private readonly tokens: Model<EmailToken>,
  ) {}

  /**
   * Makes a new link for the user and returns its token (put it in the email;
   * it is not recoverable afterwards). It replaces any earlier link of the
   * same purpose in one atomic write, so older links stop working.
   */
  async issue(
    userId: string,
    purpose: EmailTokenPurpose,
    ttlMs: number,
    now: Date = new Date(),
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.tokens.findOneAndUpdate(
      { user: new Types.ObjectId(userId), purpose },
      {
        $set: {
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + ttlMs),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return token;
  }

  /**
   * Uses a link: returns the user it belongs to, or null when the token is
   * unknown, expired or for another purpose. The document is deleted as it is
   * read, so a link works once even if two requests arrive together.
   */
  async consume(
    token: string,
    purpose: EmailTokenPurpose,
    now: Date = new Date(),
  ): Promise<string | null> {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const found = await this.tokens.findOneAndDelete({
      tokenHash: hashToken(token),
      purpose,
      expiresAt: { $gt: now },
    });
    return found ? found.user.toString() : null;
  }

  /** Cancels the user's live link of a purpose, if any. */
  async invalidate(userId: string, purpose: EmailTokenPurpose): Promise<void> {
    await this.tokens.deleteMany({
      user: new Types.ObjectId(userId),
      purpose,
    });
  }
}
