import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { UploadsModule } from '../uploads/uploads.module';
import { HotelCatalog } from './hotel-catalog';
import { HotelPhotosController } from './hotel-photos.controller';
import { HotelPhotosService } from './hotel-photos.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { HotelSearchController } from './search/hotel-search.controller';
import { HotelSearchService } from './search/hotel-search.service';
import { ModeratorReservationsController } from './search/moderator-reservations.controller';
import { ModeratorReservationsService } from './search/moderator-reservations.service';

/**
 * Hotels, rooms, availability and policies (HTL-01 to 10; search and free
 * rooms are HTL-11, 12 and 15; the moderator's reservation list is HTL-22).
 *
 * `HotelCatalog` registers the catalogue with the booking module (so hotels
 * can be reserved) and with the admin (so a hotel can be deactivated and a
 * moderator linked to it). `search/` is the read side (HTL-11, 12, 15, 22).
 * Reservations are read through the booking module's `HotelReservationQueries`,
 * never its collections.
 *
 * Controller order matters: `HotelsController` has `GET hotels/:id`, which
 * matches any single segment, so a route like `GET hotels/search` must come
 * from a controller listed **before** it (`HotelSearchController` is).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
    ]),
    AdminModule,
    HotelBookingsModule,
    ItinerariesModule,
    UploadsModule,
  ],
  controllers: [
    // Before HotelsController: `GET hotels/search` must not be read as `GET hotels/:id`.
    HotelSearchController,
    ModeratorReservationsController,
    RoomsController,
    HotelPhotosController,
    HotelsController,
  ],
  providers: [
    HotelCatalog,
    HotelsService,
    RoomsService,
    HotelPhotosService,
    HotelSearchService,
    ModeratorReservationsService,
  ],
  exports: [MongooseModule, HotelCatalog],
})
export class HotelsModule {}
