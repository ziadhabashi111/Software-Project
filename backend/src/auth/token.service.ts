import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { parseDurationMs } from '../common/utils/duration';
import { Role } from './auth.types';
import type { AuthUser } from './auth.types';

type TokenType = 'access' | 'refresh';

interface TokenPayload {
  sub: string;
  role: Role;
  typ: TokenType;
  providerId?: string;
  /** Session id. */
  sid?: string;
  /** Rotation id of a refresh token. */
  jti?: string;
  /** Must change password. */
  mcp?: true;
}

/** Signs and verifies the access and refresh JWTs (ACC-19). */
@Injectable()
export class TokenService {
  readonly accessTtlMs: number;
  readonly refreshTtlMs: number;
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) throw new Error('JWT_SECRET is missing');
    this.secret = secret;
    this.accessTtlMs = parseDurationMs(
      config.get<string>('JWT_EXPIRES_IN', '15m'),
    );
    this.refreshTtlMs = parseDurationMs(
      config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
  }

  signAccessToken(user: AuthUser): string {
    return this.sign(
      {
        ...this.identity(user),
        typ: 'access',
        ...(user.mustChangePassword ? { mcp: true as const } : {}),
      },
      this.accessTtlMs,
    );
  }

  /** `jti` changes on every refresh; the session stores the current one. */
  signRefreshToken(user: AuthUser, jti: string): string {
    return this.sign(
      { ...this.identity(user), typ: 'refresh', jti },
      this.refreshTtlMs,
    );
  }

  verifyAccessToken(token: string): AuthUser {
    const payload = this.verify(token, 'access');
    return {
      ...this.toUser(payload),
      ...(payload.mcp ? { mustChangePassword: true } : {}),
    };
  }

  verifyRefreshToken(token: string): { user: AuthUser; jti: string } {
    const payload = this.verify(token, 'refresh');
    if (!payload.jti) throw new UnauthorizedException('Invalid token');
    return { user: this.toUser(payload), jti: payload.jti };
  }

  private identity(user: AuthUser): Omit<TokenPayload, 'typ'> {
    return {
      sub: user.id,
      role: user.role,
      ...(user.providerId ? { providerId: user.providerId } : {}),
      ...(user.sessionId ? { sid: user.sessionId } : {}),
    };
  }

  private toUser(payload: TokenPayload): AuthUser {
    return {
      id: payload.sub,
      role: payload.role,
      ...(payload.providerId ? { providerId: payload.providerId } : {}),
      ...(payload.sid ? { sessionId: payload.sid } : {}),
    };
  }

  private sign(payload: TokenPayload, ttlMs: number): string {
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: Math.floor(ttlMs / 1000),
    });
  }

  private verify(token: string, expected: TokenType): TokenPayload {
    let payload: TokenPayload;
    try {
      payload = this.jwt.verify<TokenPayload>(token, { secret: this.secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== expected) {
      throw new UnauthorizedException('Invalid token type');
    }
    return payload;
  }
}
