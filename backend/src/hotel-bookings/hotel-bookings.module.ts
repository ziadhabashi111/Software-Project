import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingHooks } from './hotel-booking-hooks';
import { HotelCancellationsService } from './hotel-cancellations.service';
import { HotelInventoryRegistry } from './hotel-inventory';
import { HotelReservationPayments } from './hotel-reservation-payments';
import { HotelReservationQueries } from './hotel-reservation-queries';
import { HotelRatings } from './hotel-ratings';
import { HotelReservationsService } from './hotel-reservations.service';
import { HotelReviewsController } from './hotel-reviews.controller';
import { HotelReviewsService } from './hotel-reviews.service';
import { MyHotelReservationsService } from './my-hotel-reservations.service';
import { ReviewModerator } from './review-moderator';
import {
  HotelReservation,
  HotelReservationSchema,
} from './schemas/hotel-reservation.schema';
import { HotelReview, HotelReviewSchema } from './schemas/hotel-review.schema';
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
 * payment and `confirmPaid` from the verified webhook (PAY-01, HTL-17); `refundQuote`,
 * `refundBasis` and `recordRefundResult` for its RefundService (PAY-03, HTL-21).
 *
 * Reviews (HTL-23, HTL-24): `HotelRatings` gives the average rating and
 * count per hotel for the details page (HTL-02) and search (HTL-12); reviews
 * are registered with the admin `ContentModerators` for hide/delete (GEN-10).
 * `HotelReservationQueries` gives the hotels side taken rooms (HTL-11, 15),
 * room activity (HTL-08), deletion/deactivation checks (HTL-06) and the
 * moderator reservation list (HTL-22). `HotelBookingHooks` registers with
 * `DeactivationBlockers` (ACC-12) and `BookingSources` (ACC-17).
 * Notifications, payment cancellation and refunds are found by Ziad's tokens
 * through `SharedServices`, so there is no import cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelReservation.name, schema: HotelReservationSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
      { name: HotelReview.name, schema: HotelReviewSchema },
    ]),
    UsersModule,
    AdminModule,
  ],
  controllers: [HotelBookingsController, HotelReviewsController],
  providers: [
    HotelReservationsService,
    MyHotelReservationsService,
    HotelReservationPayments,
    HotelCancellationsService,
    HotelInventoryRegistry,
    SharedServices,
    HotelReviewsService,
    HotelRatings,
    ReviewModerator,
    HotelBookingHooks,
    HotelReservationQueries,
  ],
  exports: [
    HotelInventoryRegistry,
    HotelReservationPayments,
    HotelRatings,
    HotelReservationQueries,
    // The itinerary links a traveller's own reservations (ITN-27).
    MyHotelReservationsService,
    MongooseModule,
  ],
})
export class HotelBookingsModule {}
