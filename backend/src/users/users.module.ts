import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminSeeder } from './admin-seeder.service';
import { DeactivationBlockers } from './deactivation-blockers';
import { ProfileService } from './profile.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Owner: Habashi
 * Requirements: ACC-09, ACC-11, ACC-12, ACC-18
 *
 * Profile (`/api/users/me`), deactivation, the user schema and the admin
 * seeder. Booking modules import this module and register with
 * `DeactivationBlockers`; the reference-data module provides `CURRENCY_CATALOG`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, AdminSeeder, ProfileService, DeactivationBlockers],
  exports: [UsersService, AdminSeeder, DeactivationBlockers],
})
export class UsersModule {}
