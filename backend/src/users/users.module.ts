import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminSeeder } from './admin-seeder.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

/**
 * Owner: Habashi
 * Requirements: ACC-09, ACC-12 (profile and deactivation are added here)
 *
 * The user schema and `UsersService` are used by the auth and admin modules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [UsersService, AdminSeeder],
  exports: [UsersService, AdminSeeder],
})
export class UsersModule {}
