import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  SESSION_IDLE_LIMIT_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from '../login-policy';
import type { SessionValidator } from '../session-validator';
import { TokenService } from '../token.service';
import { Session, SessionDocument } from './session.schema';

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * Server-side login sessions (ACC-06): logout revokes them, refresh tokens
 * rotate, and a session with no authenticated request for 30 minutes expires.
 */
@Injectable()
export class SessionService implements SessionValidator {
  constructor(
    @InjectModel(Session.name) private readonly model: Model<SessionDocument>,
    private readonly tokens: TokenService,
  ) {}

  create(userId: string, refreshJti: string): Promise<SessionDocument> {
    const now = Date.now();
    return this.model.create({
      user: new Types.ObjectId(userId),
      refreshJti,
      lastActivityAt: new Date(now),
      expiresAt: new Date(now + this.tokens.refreshTtlMs),
    });
  }

  async validateAndTouch(sessionId: string): Promise<boolean> {
    if (!OBJECT_ID.test(sessionId)) return false;
    const session = await this.model.findById(sessionId).exec();
    if (!session || session.revokedAt) return false;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return false;

    const idleMs = now - session.lastActivityAt.getTime();
    if (idleMs > SESSION_IDLE_LIMIT_MS) {
      await this.revoke(sessionId);
      return false;
    }
    if (idleMs > SESSION_TOUCH_INTERVAL_MS) {
      await this.model
        .updateOne(
          { _id: sessionId, revokedAt: null },
          { lastActivityAt: new Date(now) },
        )
        .exec();
    }
    return true;
  }

  /**
   * Swaps the refresh token id if `presentedJti` is the current one and the
   * session is alive. Presenting an old id means the token was stolen or
   * replayed, so the whole session is revoked.
   */
  async rotate(
    sessionId: string,
    presentedJti: string,
    newJti: string,
  ): Promise<boolean> {
    if (!OBJECT_ID.test(sessionId)) return false;
    const now = new Date();
    const rotated = await this.model
      .findOneAndUpdate(
        {
          _id: sessionId,
          refreshJti: presentedJti,
          revokedAt: null,
          expiresAt: { $gt: now },
          lastActivityAt: {
            $gte: new Date(now.getTime() - SESSION_IDLE_LIMIT_MS),
          },
        },
        { refreshJti: newJti, lastActivityAt: now },
      )
      .exec();
    if (rotated) return true;

    const session = await this.model.findById(sessionId).exec();
    if (session && !session.revokedAt && session.refreshJti !== presentedJti) {
      await this.revoke(sessionId);
    }
    return false;
  }

  async revoke(sessionId: string): Promise<void> {
    if (!OBJECT_ID.test(sessionId)) return;
    await this.model
      .updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date() })
      .exec();
  }

  async revokeAllForUser(
    userId: string,
    session?: ClientSession,
  ): Promise<void> {
    await this.model
      .updateMany(
        { user: new Types.ObjectId(userId), revokedAt: null },
        { revokedAt: new Date() },
        { session },
      )
      .exec();
  }
}
