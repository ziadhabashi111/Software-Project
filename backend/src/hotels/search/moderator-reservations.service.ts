import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types';
import type { Paginated } from '../../common/pagination/pagination';
import {
  HotelReservationQueries,
  HotelReservationRow,
} from '../../hotel-bookings/hotel-reservation-queries';
import { assertCanViewHotelReservations } from '../hotel-access';

/**
 * HTL-22: a hotel moderator's list of their hotel's reservations (guest,
 * dates, status). Reservation data comes from the hotel-bookings module's
 * `HotelReservationQueries` (Amina); this module never reads its collections.
 */
@Injectable()
export class ModeratorReservationsService {
  constructor(private readonly queries: HotelReservationQueries) {}

  /**
   * Own hotel only for a moderator, any hotel for an admin. An admin asking
   * for a hotel id that does not exist gets an empty list, not a 404.
   */
  async list(
    hotelId: string,
    user: AuthUser,
    page: { page: number; limit: number },
  ): Promise<Paginated<HotelReservationRow>> {
    assertCanViewHotelReservations(user, hotelId);
    return this.queries.forHotel(hotelId, {
      page: page.page,
      limit: page.limit,
    });
  }
}
