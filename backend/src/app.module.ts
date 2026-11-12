import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthApiModule } from './auth/auth-api.module';
import { AuthModule } from './auth/auth.module';
import { SessionModule } from './auth/sessions/session.module';
import { BlogModule } from './blog/blog.module';
import { FlightBookingsModule } from './flight-bookings/flight-bookings.module';
import { FlightsModule } from './flights/flights.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { HotelsModule } from './hotels/hotels.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

/**
 * Every feature module is already imported here so teammates only add code
 * inside their own folder (no merge conflicts in this file).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    // One shared scheduler: use @Cron/@Interval in any module (hold expiry, daily FX).
    ScheduleModule.forRoot(),
    HealthModule,
    AuthModule,
    SessionModule,
    AuthApiModule,
    UsersModule,
    AdminModule,
    AuditModule,
    FlightsModule,
    FlightBookingsModule,
    HotelsModule,
    HotelBookingsModule,
    PaymentsModule,
    NotificationsModule,
    ItinerariesModule,
    BlogModule,
    UploadsModule,
  ],
})
export class AppModule {}
