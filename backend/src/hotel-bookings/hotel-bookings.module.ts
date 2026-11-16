import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelInventoryRegistry } from './hotel-inventory';
import { HotelReservationsService } from './hotel-reservations.service';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema';

/**
 * Owner: Amina (booking, reviews)
 * Requirements: HTL-16..24
 *
 * Hotel reservations: concurrency-safe 10-minute holds (HTL-16, HTL-18).
 * The hotels module plugs in through `HotelInventoryRegistry` (rooms, prices,
 * occupancy, availability and blocks). The exported models let it check for
 * Confirmed or Pending Payment reservations (HTL-06, HTL-08, HTL-11, HTL-22).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [HotelReservationsService, HotelInventoryRegistry],
  exports: [HotelInventoryRegistry, MongooseModule],
})
export class HotelBookingsModule {}
