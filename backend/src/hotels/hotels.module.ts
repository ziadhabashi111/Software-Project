import { Module } from '@nestjs/common';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { ModeratorReservationsController } from './search/moderator-reservations.controller';
import { ModeratorReservationsService } from './search/moderator-reservations.service';

/**
 * Owner: Abdelrahman (hotels, rooms, availability, policies)
 * Requirements: HTL-01..12, HTL-15, HTL-22
 * Add controllers, services, schemas/ and dto/ in this folder.
 *
 * `search/` is the read side (Noureldin: HTL-11, 12, 15, 22). The moderator
 * reservation list (HTL-22) reads reservations through the hotel-bookings
 * module's exported `HotelReservationQueries`, never its collections.
 */
@Module({
  imports: [HotelBookingsModule],
  controllers: [ModeratorReservationsController],
  providers: [ModeratorReservationsService],
})
export class HotelsModule {}
