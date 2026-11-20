import { Module } from '@nestjs/common';
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
import { PasswordResetService } from './password-reset.service';

/**
 * Owner: Habashi
 * Requirements: ACC-01, ACC-04, ACC-05, ACC-06, ACC-07, ACC-08, ACC-19
 *
 * The HTTP side of authentication: register, login, refresh, logout, me,
 * change-password and the emailed password reset (ACC-07). The guards and
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
  providers: [AuthService, PasswordResetService, EmailTokenService],
  exports: [EmailTokenService],
})
export class AuthApiModule {}
