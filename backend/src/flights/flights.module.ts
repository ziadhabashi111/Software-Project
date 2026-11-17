import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { FlightBookingHooks } from './flight-booking-hooks';
import { FlightManagementService } from './flight-management.service';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Airport, AirportSchema } from './schemas/airport.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

/**
 * Owner: Youssef Wahby (airlines, flights, flight search)
 * Requirements: FLT-01..09, FLT-11, FLT-12, FLT-15, FLT-17, FLT-29, FLT-30
 *
 * Airlines (profile, baggage and cancellation policies), the read-only
 * airport list, and flights with cabins and status (FLT-03..05, FLT-30). The airline registers itself with the admin's
 * `ProviderDirectory` so ACC-13 and ACC-15 work. Exported models and
 * services let flight booking read airlines and airports.
 */
@Module({
  imports: [
    AdminModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
  ],
  controllers: [
    AirlinesController,
    AirportsController,
    FlightSearchController,
    FlightsController,
  ],
  providers: [
    AirlinesService,
    AirportsService,
    FlightsService,
    FlightManagementService,
    FlightSearchService,
    FlightBookingHooks,
  ],
  exports: [
    MongooseModule,
    AirlinesService,
    AirportsService,
    FlightsService,
    FlightSearchService,
    FlightBookingHooks,
  ],
})
export class FlightsModule {}
