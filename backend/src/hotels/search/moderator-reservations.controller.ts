import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { Paginated } from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../../common/swagger/api-req.decorator';
import type { HotelReservationRow } from '../../hotel-bookings/hotel-reservation-queries';
import { ModeratorReservationsService } from './moderator-reservations.service';

@ApiTags('hotels')
@ApiCookieAuth()
@Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
@Controller('hotels')
export class ModeratorReservationsController {
  constructor(private readonly reservations: ModeratorReservationsService) {}

  @Get(':id/reservations')
  @ApiReq(
    ['HTL-22', 'ACC-11'],
    'Reservations of a hotel (own hotel)',
    'Guest name, dates and status of every reservation of the hotel, latest check-in first; also reference, rooms and total. Paginated (10 per page, at most 100). Only the moderator linked to this hotel, or an admin, can see them (others get 403). Guests whose account was deactivated show as "Deleted user".',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [
          {
            id: '6660a1b2c3d4e5f601234567',
            reference: 'HB-7K2M9Q',
            guest: { id: '6660a1b2c3d4e5f601234568', name: 'Ana Hassan' },
            rooms: [
              {
                roomId: '6660a1b2c3d4e5f601234569',
                name: '101',
                adults: 2,
                children: 1,
              },
            ],
            checkIn: '2027-02-01',
            checkOut: '2027-02-04',
            nights: 3,
            totalPrice: 360,
            currency: 'USD',
            status: 'Confirmed',
            createdAt: '2027-01-10T09:30:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Not logged in' })
  @ApiForbiddenResponse({
    description: 'Not the moderator of this hotel (or not a hotel moderator)',
  })
  @ApiNotFoundResponse({ description: 'The id is not a valid hotel id' })
  list(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<HotelReservationRow>> {
    return this.reservations.list(id, user, query);
  }
}
