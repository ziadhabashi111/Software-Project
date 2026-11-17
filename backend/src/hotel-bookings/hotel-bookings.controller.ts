import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelReservationsService } from './hotel-reservations.service';
import type { HotelReservationView } from './reservation-view';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly reservations: HotelReservationsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiReq(
    ['HTL-16', 'HTL-18'],
    'Reserve rooms (10-minute hold)',
    'Holds one or more rooms of the same hotel for the same dates as one Pending Payment reservation for 10 minutes. Guests are assigned per room (adults, children aged 0-17); the reservation needs at least one adult and no room may exceed its maximum occupancy. The total is the sum over rooms of nights x the price per night at booking time. If any room overlaps a Confirmed reservation, an unexpired hold or a blocked range, the whole request is rejected (409) and nothing is held. Check-out must be after check-in, a stay covers at most 30 nights, and check-in cannot be in the past. Unpaid holds become Expired after 10 minutes and the rooms are released.',
  )
  @ApiCreatedResponse({
    description: 'The Pending Payment reservation and its hold expiry',
    schema: {
      example: {
        id: '6660a1b2c3d4e5f601234567',
        reference: null,
        hotel: { id: '665f1c2a9b1e8a0012345670', name: 'Nile View Hotel' },
        checkIn: '2027-03-01',
        checkOut: '2027-03-04',
        nights: 3,
        rooms: [
          {
            roomId: '665f1c2a9b1e8a0012345678',
            name: '101',
            type: 'Double',
            adults: 2,
            childrenAges: [7],
            pricePerNight: 120,
            subtotal: 360,
          },
        ],
        guests: { adults: 2, children: 1 },
        totalPrice: 360,
        currency: 'USD',
        status: 'Pending Payment',
        holdExpiresAt: '2026-11-16T12:10:00.000Z',
        createdAt: '2026-11-16T12:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid dates (including a stay over 30 nights, STAY_TOO_LONG), no adult, a room over its occupancy, a room not in this hotel or not available (blocked, inactive or outside its availability)',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  @ApiConflictResponse({
    description:
      'A selected room is already reserved or held for these dates; nothing was held (code ROOMS_UNAVAILABLE)',
  })
  @ApiForbiddenResponse({ description: 'Only registered users book hotels' })
  @ApiServiceUnavailableResponse({
    description: 'The hotel catalogue is not connected yet',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHotelBookingDto,
  ): Promise<HotelReservationView> {
    return this.reservations.hold(user, dto);
  }
}
