import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { FlightsModule } from '../flights/flights.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryFlightsController } from './itinerary-flights.controller';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryModerator } from './itinerary-moderator';
import { ItineraryRepository } from './itinerary.repository';
import { PlaceCatalog } from './places';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/**
 * Owner: Habashi (structure), Youssef Wahby (budgets / exchange rates)
 * Requirements: ITN-01, 03, 05, 07, 08, 09, 10, 20 (and ITN-12 once the upload
 * helper exists)
 *
 * Itineraries with their days and activities. Other modules plug in through
 * two hooks (import this module and inject them):
 * `PlaceCatalog` (the predefined country and city lists, from the
 * reference-data module) and `ItineraryBudgets` (day budget totals and
 * cleanup, from the budget module).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
    AdminModule,
    FlightsModule,
  ],
  controllers: [
    ItinerariesController,
    ActivitiesController,
    ItineraryFlightsController,
  ],
  providers: [
    ItinerariesService,
    ActivitiesService,
    ItineraryFlightsService,
    ItineraryRepository,
    ItineraryModerator,
    PlaceCatalog,
    ItineraryBudgets,
  ],
  exports: [PlaceCatalog, ItineraryBudgets, ItineraryRepository],
})
export class ItinerariesModule {}
