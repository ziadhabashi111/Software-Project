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
  providerId?: string;
  typ: TokenType;
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
    return this.sign(user, 'access', this.accessTtlMs);
  }

  signRefreshToken(user: AuthUser): string {
    return this.sign(user, 'refresh', this.refreshTtlMs);
  }

  verifyAccessToken(token: string): AuthUser {
    return this.verify(token, 'access');
  }

  verifyRefreshToken(token: string): AuthUser {
    return this.verify(token, 'refresh');
  }

  private sign(user: AuthUser, typ: TokenType, ttlMs: number): string {
    const payload: TokenPayload = {
      sub: user.id,
      role: user.role,
      typ,
      ...(user.providerId ? { providerId: user.providerId } : {}),
    };
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: Math.floor(ttlMs / 1000),
    });
  }

  private verify(token: string, expected: TokenType): AuthUser {
    let payload: TokenPayload;
    try {
      payload = this.jwt.verify<TokenPayload>(token, { secret: this.secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== expected) {
      throw new UnauthorizedException('Invalid token type');
    }
    return {
      id: payload.sub,
      role: payload.role,
      ...(payload.providerId ? { providerId: payload.providerId } : {}),
    };
  }
}
