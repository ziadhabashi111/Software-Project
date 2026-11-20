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
import { City, CitySchema } from '../reference-data/schemas/city.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { ModeratorReservationsController } from './search/moderator-reservations.controller';
import { ModeratorReservationsService } from './search/moderator-reservations.service';

/**
 * Hotels, rooms, availability and policies (HTL-01 to 10; the moderator's
 * reservation list is HTL-22).
 *
 * `HotelCatalog` registers the catalogue with the booking module (so hotels
 * can be reserved) and with the admin (so a hotel can be deactivated and a
 * moderator linked to it). `search/` is the read side (HTL-11, 12, 15, 22).
 * Reservations are read through the booking module's `HotelReservationQueries`,
 * never its collections.
 *
 * Controller order matters: `HotelsController` has `GET hotels/:id`, which
 * matches any single segment, so a route like `GET hotels/search` must come
 * from a controller listed **before** it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      // Read-only reference data: a hotel's city must be in its country.
      { name: City.name, schema: CitySchema },
    ]),
    AdminModule,
    HotelBookingsModule,
    ItinerariesModule,
    UploadsModule,
  ],
  controllers: [
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
    ModeratorReservationsService,
  ],
  exports: [MongooseModule, HotelCatalog],
})
export class HotelsModule {}
