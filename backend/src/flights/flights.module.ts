import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { AirportsController } from './airports.controller';
import { AirportsService } from './airports.service';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Airport, AirportSchema } from './schemas/airport.schema';

/**
 * Owner: Youssef Wahby (airlines, flights, flight search)
 * Requirements: FLT-01..09, FLT-11, FLT-12, FLT-15, FLT-17, FLT-29, FLT-30
 *
 * Airlines (profile, baggage and cancellation policies) and the read-only
 * airport list. The airline registers itself with the admin's
 * `ProviderDirectory` so ACC-13 and ACC-15 work. Exported models and
 * services let flight booking read airlines and airports.
 */
@Module({
  imports: [
    AdminModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
    ]),
  ],
  controllers: [AirlinesController, AirportsController],
  providers: [AirlinesService, AirportsService],
  exports: [MongooseModule, AirlinesService, AirportsService],
})
export class FlightsModule {}
