import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { BlogModule } from '../blog/blog.module';
import { FlightsModule } from '../flights/flights.module';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ActivitiesController } from './activities.controller';
import { BudgetController } from './budget/budget.controller';
import { BudgetProvider } from './budget/budget-provider';
import { BudgetSummaryService } from './budget/budget-summary.service';
import {
  ExchangeRates,
  ExchangeRatesSchema,
} from './budget/fx/exchange-rates.schema';
import { FxService } from './budget/fx/fx.service';
import { BudgetService } from './budget/budget.service';
import {
  BudgetEntry,
  BudgetEntrySchema,
} from './budget/schemas/budget-entry.schema';
import {
  TransportCost,
  TransportCostSchema,
} from './budget/schemas/transport-cost.schema';
import { ActivitiesService } from './activities.service';
import { ActivityImagesService } from './activity-images.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { HotelSearchHook } from './hotel-search';
import { ItineraryCloneService } from './itinerary-clone.service';
import { ItineraryFlightsController } from './itinerary-flights.controller';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItineraryHotelsController } from './itinerary-hotels.controller';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { ItineraryBudgets } from './itinerary-budgets';
import { ItineraryModerator } from './itinerary-moderator';
import { ItineraryRepository } from './itinerary.repository';
import { PlaceCatalog } from './places';
import { PublicItinerariesController } from './public-itineraries.controller';
import { PublicItinerariesService } from './public-itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/**
 * Owner: Habashi (structure), Youssef Wahby (budgets / exchange rates)
 * Requirements: ITN-01, 03, 05, 07, 08, 09, 10, 12, 20, 21, 25
 *
 * Itineraries with their days and activities, activity images (ITN-12, through
 * the shared upload helper), public itineraries and cloning (ITN-21), and
 * hotels for a city group (ITN-25). Other modules plug in
 * through hooks (import this module and inject them): `PlaceCatalog` (the
 * predefined country and city lists, from the reference-data module),
 * `ItineraryBudgets` (day budget totals, cloning and cleanup, from the budget
 * module) and `HotelSearchHook` (the hotel search, HTL-11, from the hotels
 * module). The author page of the blog (BLG-12) reads an author's public
 * itineraries from here through the blog's `AuthorItineraries`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: BudgetEntry.name, schema: BudgetEntrySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
      { name: ExchangeRates.name, schema: ExchangeRatesSchema },
    ]),
    AdminModule,
    BlogModule,
    FlightsModule,
    UploadsModule,
    UsersModule,
  ],
  controllers: [
    // First, so `itineraries/public/...` is never read as `itineraries/:id`.
    PublicItinerariesController,
    ItinerariesController,
    ActivitiesController,
    BudgetController,
    ItineraryFlightsController,
    ItineraryHotelsController,
  ],
  providers: [
    ItinerariesService,
    ItineraryCloneService,
    PublicItinerariesService,
    ActivitiesService,
    ActivityImagesService,
    BudgetService,
    BudgetSummaryService,
    BudgetProvider,
    FxService,
    ItineraryFlightsService,
    ItineraryHotelsService,
    ItineraryRepository,
    ItineraryModerator,
    PlaceCatalog,
    ItineraryBudgets,
    HotelSearchHook,
  ],
  exports: [
    PlaceCatalog,
    ItineraryBudgets,
    ItineraryRepository,
    BudgetService,
    HotelSearchHook,
  ],
})
export class ItinerariesModule {}
