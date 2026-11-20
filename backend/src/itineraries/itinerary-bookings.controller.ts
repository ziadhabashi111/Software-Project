import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { LinkBookingDto } from './dto/link-booking.dto';
import type { LinkedBookingView } from './itinerary-booking-view';
import { ItineraryBookingsService } from './itinerary-bookings.service';

const LINKED_EXAMPLE = {
  id: '6660a1b2c3d4e5f601234569',
  bookingType: 'hotel',
  bookingId: '6660a1b2c3d4e5f601234567',
  dayId: '6660a1b2c3d4e5f601234568',
  dayNumber: 2,
  reference: 'HB-7K2M9Q',
  title: 'Nile View Hotel',
  status: 'CONFIRMED',
  startDate: '2027-03-10',
  endDate: '2027-03-13',
  amount: 450,
  currency: 'USD',
  counted: true,
};

/**
 * Bookings linked to the days of an itinerary (ITN-27, optional bonus). Owner
 * only: anyone else gets 404, and only the owner's own bookings can be linked.
 */
@ApiTags('itineraries')
@ApiCookieAuth()
@Roles(Role.USER)
@ApiForbiddenResponse({ description: 'Only regular users plan itineraries' })
@ApiNotFoundResponse({ description: 'Itinerary not found, or not yours' })
@Controller('itineraries/:id/bookings')
export class ItineraryBookingsController {
  constructor(private readonly bookings: ItineraryBookingsService) {}

  @Post()
  @ApiReq(
    'ITN-27',
    'Link a booking to a day of my itinerary (optional bonus)',
    'Links one of your own Confirmed (or Completed) flight bookings or hotel reservations to a day. Linked bookings feed your budget summary: a flight counts as intercity transport and a hotel stay as accommodation, on that day, in the booking’s currency (converted like every other line). A booking cancelled later stops counting but stays listed. A booking that is not yours is a 404, and the same booking cannot be linked twice. Linked bookings are never shown on a public itinerary or in its public budget.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiCreatedResponse({ schema: { example: LINKED_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Invalid ids or booking type, or a day not in this itinerary',
  })
  @ApiConflictResponse({
    description:
      'The booking is not confirmed (pending, expired or cancelled), or it is already linked to this itinerary',
  })
  link(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: LinkBookingDto,
  ): Promise<LinkedBookingView> {
    return this.bookings.link(user, id, dto);
  }

  @Get()
  @ApiReq(
    'ITN-27',
    'List the bookings linked to my itinerary (optional bonus)',
    'Every linked booking by day, with its reference, status, dates and price as they are right now. `counted` is false once a booking is cancelled or expired, because it no longer feeds the budget.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiOkResponse({ schema: { example: [LINKED_EXAMPLE] } })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<LinkedBookingView[]> {
    return this.bookings.list(user, id);
  }

  @Delete(':linkId')
  @HttpCode(204)
  @ApiReq(
    'ITN-27',
    'Unlink a booking from my itinerary (optional bonus)',
    'Removes the link and its effect on the budget. The booking itself is untouched.',
  )
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiParam({ name: 'linkId', description: 'Id of the link (not the booking)' })
  @ApiNoContentResponse({ description: 'Unlinked' })
  async unlink(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('linkId', ParseObjectIdPipe) linkId: string,
  ): Promise<void> {
    await this.bookings.unlink(user, id, linkId);
  }
}
