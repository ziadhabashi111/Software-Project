import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Owner: Habashi
 * Requirements: ACC-01, ACC-04, ACC-05, ACC-06, ACC-08, ACC-19
 *
 * The HTTP side of authentication: register, login, refresh, logout, me and
 * change-password. The guards and token/cookie/password services it uses live
 * in the global `AuthModule`, the session store in `SessionModule`.
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthApiModule {}
