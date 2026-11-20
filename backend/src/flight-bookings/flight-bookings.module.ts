import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { FlightsModule } from '../flights/flights.module';
import { UsersModule } from '../users/users.module';
import { FlightBookingChangesService } from './flight-booking-changes.service';
import { FlightBookingExpiryService } from './flight-booking-expiry.service';
import { FlightBookingCancellationsService } from './flight-booking-cancellations.service';
import { FlightBookingLinkAdapter } from './flight-booking-link';
import { FlightBookingPayments } from './flight-booking-payments';
import { FlightBookingHoldsService } from './flight-booking-holds.service';
import { FlightBookingQuotesService } from './flight-booking-quotes.service';
import { FlightBookingViews } from './flight-booking-view';
import { FlightBookingsController } from './flight-bookings.controller';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import {
  FlightBookingChange,
  FlightBookingChangeSchema,
} from './schemas/flight-booking-change.schema';
import { MyFlightBookingsService } from './my-flight-bookings.service';
import { FlightBookingRegistrations } from './registrations/flight-booking-registrations';
import { FlightSeatsController } from './flight-seats.controller';
import {
  SeatAssignment,
  SeatAssignmentSchema,
} from './schemas/seat-assignment.schema';
import { SeatAssignments } from './seat-assignments';
import { SeatInventory } from './seat-inventory';
import { SeatSelectionService } from './seat-selection.service';
import { SharedServices } from './shared-services';

/**
 * Owner: Yahia Tarek (member 3)
 * Requirements: FLT-12, FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-26, FLT-28,
 * GEN-06, GEN-11; hooks for FLT-05/06/29, PAY-01..03, ACC-12, ACC-17;
 * bonus FLT-27 (change flight, docs/design/2026-11-20-flight-change-design.md).
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
      { name: FlightBookingChange.name, schema: FlightBookingChangeSchema },
      { name: SeatAssignment.name, schema: SeatAssignmentSchema },
    ]),
    FlightsModule,
    UsersModule,
    AdminModule,
  ],
  controllers: [FlightBookingsController, FlightSeatsController],
  providers: [
    SharedServices,
    SeatInventory,
    FlightBookingViews,
    FlightBookingQuotesService,
    FlightBookingHoldsService,
    FlightBookingExpiryService,
    FlightBookingPayments,
    MyFlightBookingsService,
    FlightBookingChangesService,
    FlightBookingCancellationsService,
    FlightBookingLinkAdapter,
    FlightBookingRegistrations,
    SeatAssignments,
    SeatSelectionService,
  ],
  exports: [
    FlightBookingPayments,
    FlightBookingChangesService,
    SeatAssignments,
    // The itinerary links a traveller's own bookings (ITN-27).
    MyFlightBookingsService,
  ],
})
export class FlightBookingsModule {}
