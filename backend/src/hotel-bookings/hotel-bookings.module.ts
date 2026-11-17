import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelInventoryRegistry } from './hotel-inventory';
import { HotelReservationPayments } from './hotel-reservation-payments';
import { HotelReservationsService } from './hotel-reservations.service';
import { MyHotelReservationsService } from './my-hotel-reservations.service';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema';
import { SharedServices } from './shared-services';

/**
 * Owner: Amina (booking, reviews)
 * Requirements: HTL-16..24
 *
 * Hotel reservations: concurrency-safe 10-minute holds (HTL-16, HTL-18).
 * The hotels module plugs in through `HotelInventoryRegistry` (rooms, prices,
 * occupancy, availability and blocks). The exported models let it check for
 * Confirmed or Pending Payment reservations (HTL-06, HTL-08, HTL-11, HTL-22).
 *
 * The payments module (Ziad) imports this module and uses the exported
 * `HotelReservationPayments`: `forPayment` / `attachPaymentIntent` to start a
 * payment and `confirmPaid` from the verified webhook (PAY-01, HTL-17).
 * Notifications, payment cancellation and refunds are found by Ziad's tokens
 * through `SharedServices`, so there is no import cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [
    HotelReservationsService,
    MyHotelReservationsService,
    HotelReservationPayments,
    HotelInventoryRegistry,
    SharedServices,
  ],
  exports: [HotelInventoryRegistry, HotelReservationPayments, MongooseModule],
})
export class HotelBookingsModule {}
