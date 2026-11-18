import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { FlightsModule } from '../flights/flights.module';
import { UsersModule } from '../users/users.module';
import { FlightBookingQuotesService } from './flight-booking-quotes.service';
import { FlightBookingViews } from './flight-booking-view';
import { FlightBookingsController } from './flight-bookings.controller';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import { SharedServices } from './shared-services';

/**
 * Owner: Yahia Tarek (member 3)
 * Requirements: FLT-12, FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-26,
 * GEN-06, GEN-11; hooks for FLT-05/06/29, PAY-01..03, ACC-12, ACC-17.
 * Design: docs/design/2026-11-16-flight-bookings-design.md
 *
 * Seats are held with conditional updates on the flights module's cabin
 * counters (FLT-22). Ziad's notification, payment and refund services are
 * found by token through `SharedServices`, so there is no import cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
    FlightsModule,
    UsersModule,
    AdminModule,
  ],
  controllers: [FlightBookingsController],
  providers: [SharedServices, FlightBookingViews, FlightBookingQuotesService],
  exports: [MongooseModule],
})
export class FlightBookingsModule {}
