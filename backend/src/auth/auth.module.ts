import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthGuard } from './auth.guard';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';

/**
 * Owner: Habashi
 * Requirements: ACC-01, ACC-04..08, ACC-11, ACC-12, ACC-19, GEN-13
 *
 * Global: every route is protected by `AuthGuard` + `RolesGuard` unless it is
 * marked `@Public()`. `TokenService`, `PasswordService` and
 * `AuthCookiesService` can be injected anywhere without importing this module.
 * Controllers and services for register/login/etc. are added in this folder.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    TokenService,
    PasswordService,
    AuthCookiesService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenService, PasswordService, AuthCookiesService],
})
export class AuthModule {}
