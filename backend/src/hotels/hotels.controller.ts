import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelPoliciesDto } from './dto/hotel-policies.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import type { HotelView } from './hotel-view';
import { HotelsService } from './hotels.service';

const HOTEL_EXAMPLE = {
  id: '665f1c2a9b1e8a0012345670',
  name: 'Nile View Hotel',
  address: '12 Corniche El Nil',
  city: 'cairo',
  country: 'EG',
  description: 'On the Nile, ten minutes from the museum.',
  starClass: 4,
  amenities: ['wifi', 'pool', 'breakfast'],
  photos: [],
  checkInTime: '14:00',
  checkOutTime: '12:00',
  isActive: true,
  cancellationPolicy: [
    { daysBefore: 14, refundPercent: 100 },
    { daysBefore: 3, refundPercent: 50 },
  ],
  rating: { averageRating: 4.5, ratingCount: 12 },
};

/**
 * Hotel profiles and policies (HTL-01, 02, 09, 10).
 *
 * `GET :id` matches any path segment, so a route such as `GET hotels/search`
 * must be declared in a controller listed **before** this one in
 * `HotelsModule`.
 */
@ApiTags('hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth()
  @ApiReq(
    'HTL-01',
    'Create a hotel (admin)',
    'Creates the hotel profile: name, address, city and country from the predefined lists, description, star class (1 to 5) and amenities. Create its moderator afterwards with POST /api/admin/moderators (ACC-13), which links the moderator to this hotel.',
  )
  @ApiCreatedResponse({ schema: { example: HOTEL_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Invalid field, or a city or country not in the lists',
  })
  @ApiForbiddenResponse({ description: 'Only admins create hotels' })
  create(@Body() dto: CreateHotelDto): Promise<HotelView> {
    return this.hotels.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiReq(
    ['HTL-02', 'HTL-09', 'HTL-10'],
    'Hotel details',
    'Open to everyone: the profile, photos, amenities, check-in and check-out times, the cancellation policy (longest notice first) and the average rating. A deactivated hotel is hidden (404) except from admins and its own moderator. Reviews are listed by GET /api/hotels/:id/reviews; the rooms available for given dates by GET /api/hotels/:id/rooms/available.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({ schema: { example: HOTEL_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  get(
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<HotelView> {
    return this.hotels.get(id, user);
  }

  @Patch(':id')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'HTL-01',
    'Edit my hotel’s profile (moderator)',
    'Send only the fields to change. A moderator edits only the hotel they are linked to.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({ schema: { example: HOTEL_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Nothing to change, or an invalid field',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this hotel' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
  ): Promise<HotelView> {
    return this.hotels.update(user, id, dto);
  }

  @Put(':id/policies')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    ['HTL-09', 'HTL-10'],
    'Set check-in/check-out times and cancellation tiers (moderator)',
    'Send the standard check-in and check-out times (HH:mm) and/or the whole list of cancellation tiers, which replaces the existing ones. Each tier has a unique days-before-check-in threshold (whole number >= 0) and a refund percentage (0 to 100); a cancellation uses the tier with the highest threshold not above the days remaining, and refunds 0% if none applies (the same rule as flights, FLT-09).',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({ schema: { example: HOTEL_EXAMPLE } })
  @ApiBadRequestResponse({
    description:
      'Nothing to set, a bad time, a duplicate threshold or a percentage outside 0-100',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this hotel' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  setPolicies(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: HotelPoliciesDto,
  ): Promise<HotelView> {
    return this.hotels.setPolicies(user, id, dto);
  }
}
