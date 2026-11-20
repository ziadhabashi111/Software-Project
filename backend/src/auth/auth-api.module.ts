import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  EmailToken,
  EmailTokenSchema,
} from './email-tokens/email-token.schema';
import { EmailTokenService } from './email-tokens/email-token.service';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { VerifiedEmailGuard } from './verified-email.guard';

/**
 * Owner: Habashi
 * Requirements: ACC-01, ACC-02, ACC-04, ACC-05, ACC-06, ACC-07, ACC-08, ACC-19
 *
 * The HTTP side of authentication: register, login, refresh, logout, me,
 * change-password, the emailed password reset (ACC-07) and email
 * verification (ACC-02). The guards and
 * token/cookie/password services it uses live in the global `AuthModule`, the
 * session store in `SessionModule`.
 */
@Module({
  imports: [
    UsersModule,
    MailModule,
    MongooseModule.forFeature([
      { name: EmailToken.name, schema: EmailTokenSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    EmailVerificationService,
    EmailTokenService,
    // After the global AuthGuard (AuthModule is imported first), which sets
    // the logged-in user this guard needs. Without a user it answers 401.
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
  ],
  exports: [EmailTokenService],
})
export class AuthApiModule {}
