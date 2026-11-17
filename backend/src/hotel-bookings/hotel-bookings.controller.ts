import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import type { RefundQuote } from './cancellation-rules';
import { ConfirmCancelQueryDto } from './dto/confirm-cancel.dto';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import {
  ListHotelBookingsDto,
  ReservationGroup,
} from './dto/list-hotel-bookings.dto';
import {
  CancellationResult,
  HotelCancellationsService,
} from './hotel-cancellations.service';
import { HotelReservationsService } from './hotel-reservations.service';
import { MyHotelReservationsService } from './my-hotel-reservations.service';
import type { HotelReservationView } from './reservation-view';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly reservations: HotelReservationsService,
    private readonly mine: MyHotelReservationsService,
    private readonly cancellations: HotelCancellationsService,
  ) {}

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
        status: 'PENDING_PAYMENT',
        holdExpiresAt: '2026-11-16T12:10:00.000Z',
        confirmedAt: null,
        cancelledAt: null,
        payment: null,
        refund: null,
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

  @Get()
  @Roles(Role.USER)
  @ApiReq(
    'HTL-20',
    'My hotel reservations, grouped',
    'One group per request (upcoming, past or cancelled), 10 per page. Each item shows reference, hotel, rooms, dates, guests, total and status. Only your own reservations.',
  )
  @ApiOkResponse({
    description: '{ group, items, total, page, limit }',
  })
  @ApiForbiddenResponse({ description: 'Only registered users have bookings' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListHotelBookingsDto,
  ): Promise<Paginated<HotelReservationView> & { group: ReservationGroup }> {
    return this.mine.list(user, query);
  }

  @Get(':id')
  @Roles(Role.USER, Role.ADMIN, Role.HOTEL_MODERATOR)
  @ApiReq(
    ['HTL-17', 'HTL-20', 'ACC-11'],
    'Reservation details (confirmation page)',
    'Full details with payment status and refund status. Visible to the owner, admins and the moderator of that hotel; anyone else gets 404.',
  )
  @ApiParam({ name: 'id', description: 'Reservation id' })
  @ApiOkResponse({ description: 'The reservation' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelReservationView> {
    return this.mine.get(user, id);
  }

  @Get(':id/cancellation')
  @Roles(Role.USER)
  @ApiReq(
    ['HTL-21', 'HTL-10'],
    'Refund preview before cancelling',
    "What cancelling now would refund: the hotel's tier with the highest days-before-check-in threshold not above the days remaining (0% if none), applied to the full total. Uses the tiers in force when the reservation was made. Owner only.",
  )
  @ApiParam({ name: 'id', description: 'Reservation id' })
  @ApiOkResponse({
    schema: {
      example: {
        reservationId: '6660a1b2c3d4e5f601234567',
        checkIn: '2027-03-01',
        daysBeforeCheckIn: 12,
        totalPrice: 360,
        refundPercent: 50,
        refundAmount: 180,
        currency: 'USD',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  @ApiConflictResponse({
    description:
      'Not Confirmed (NOT_CANCELLABLE) or the check-in date has been reached (CHECK_IN_REACHED)',
  })
  previewCancellation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<RefundQuote> {
    return this.cancellations.preview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiReq(
    ['HTL-21', 'PAY-03'],
    'Cancel my reservation (whole reservation only)',
    'Requires ?confirm=true. Cancels your own Confirmed reservation as a whole (no partial cancellation) before the check-in date. All its rooms are released, the refund from the preview is created and sent through the payments module, and you get an in-app notification.',
  )
  @ApiParam({ name: 'id', description: 'Reservation id' })
  @ApiOkResponse({
    description: '{ reservation, refund } with the reservation now CANCELLED',
  })
  @ApiBadRequestResponse({ description: 'Missing ?confirm=true' })
  @ApiNotFoundResponse({ description: 'Not found, or not yours' })
  @ApiConflictResponse({
    description:
      'Not Confirmed (NOT_CANCELLABLE) or the check-in date has been reached (CHECK_IN_REACHED)',
  })
  cancel(
    // Validated only: the cancellation runs once the confirmation is there.
    @Query() _confirm: ConfirmCancelQueryDto,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<CancellationResult> {
    return this.cancellations.cancel(user, id);
  }
}
