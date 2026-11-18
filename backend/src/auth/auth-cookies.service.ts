import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.constants';
import { TokenService } from './token.service';

/**
 * Sets and clears the httpOnly auth cookies (ACC-19). Secure, SameSite and
 * Domain come from the environment so deployment needs no code change.
 */
@Injectable()
export class AuthCookiesService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
  ) {}

  set(
    res: Response,
    tokens: { accessToken: string; refreshToken: string },
  ): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...this.baseOptions(),
      maxAge: this.tokens.accessTtlMs,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.baseOptions(),
      maxAge: this.tokens.refreshTtlMs,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.baseOptions());
    res.clearCookie(REFRESH_COOKIE, this.baseOptions());
  }

  private baseOptions(): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE', 'false') === 'true',
      sameSite: this.config.get<string>('COOKIE_SAMESITE', 'lax') as
        'lax' | 'strict' | 'none',
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }
}
