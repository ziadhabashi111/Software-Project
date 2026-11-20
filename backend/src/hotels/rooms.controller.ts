import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
import type { Paginated } from '../common/pagination/pagination';
import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { CreateRoomDto, UpdateRoomDto } from './dto/create-room.dto';
import { DateRangeDto, ReplaceAvailabilityDto } from './dto/date-range.dto';
import type { RoomView } from './room-view';
import { RoomsService } from './rooms.service';
import type { AvailabilityView } from './rooms.service';

const ROOM_EXAMPLE = {
  id: '665f1c2a9b1e8a0012345678',
  hotelId: '665f1c2a9b1e8a0012345670',
  name: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 120,
  isActive: true,
  availability: [
    { id: '665f1c2a9b1e8a0012345680', from: '2027-03-01', to: '2027-03-31' },
  ],
  blocked: [
    { id: '665f1c2a9b1e8a0012345681', from: '2027-03-10', to: '2027-03-12' },
  ],
};

/** The rooms of a hotel (HTL-03 to 06, HTL-08). Only the hotel's own moderator; anyone else gets 403. */
@ApiTags('hotels')
@ApiCookieAuth()
@Roles(Role.HOTEL_MODERATOR)
@ApiForbiddenResponse({ description: 'Not the moderator of this hotel' })
@Controller('hotels/:id')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post('rooms')
  @ApiReq(
    'HTL-03',
    'Add a room',
    'A room is an individually bookable unit: a number or name that is unique within the hotel, a type, the number of beds, the maximum occupancy (at least 1) and the price per night (above 0). It cannot be booked until you give it availability.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiCreatedResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Invalid field' })
  @ApiConflictResponse({
    description: 'The hotel already has a room with this number or name',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomView> {
    return this.rooms.create(user, id, dto);
  }

  @Get('rooms')
  @ApiReq(
    ['HTL-03', 'HTL-04', 'HTL-06'],
    'List my hotel’s rooms',
    'Every room with its availability ranges and blocked ranges, by room number or name, 10 per page (GEN-05).',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({
    schema: {
      example: { items: [ROOM_EXAMPLE], total: 1, page: 1, limit: 10 },
    },
  })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListRoomsQueryDto,
  ): Promise<Paginated<RoomView>> {
    return this.rooms.list(user, id, query);
  }

  @Patch('rooms/:roomId')
  @ApiReq(
    'HTL-05',
    'Edit a room',
    'Beds, maximum occupancy, price per night and type. A price change does not affect existing reservations: they keep the price they were made at.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiOkResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Nothing to change, or an invalid field',
  })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomView> {
    return this.rooms.update(user, id, roomId, dto);
  }

  @Delete('rooms/:roomId')
  @HttpCode(204)
  @ApiReq(
    'HTL-06',
    'Delete a room',
    'Only a room that has never been reserved can be deleted. Otherwise deactivate it.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiConflictResponse({
    description: 'The room has been reserved (code ROOM_HAS_RESERVATIONS)',
  })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
  ): Promise<void> {
    return this.rooms.remove(user, id, roomId);
  }

  @Patch('rooms/:roomId/deactivate')
  @ApiReq(
    'HTL-06',
    'Deactivate a room',
    'A deactivated room is left out of search and cannot be booked. Refused while the room is taken tonight or on a later night by a Confirmed reservation or a live hold.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiOkResponse({ schema: { example: { ...ROOM_EXAMPLE, isActive: false } } })
  @ApiConflictResponse({
    description:
      'The room has reservations from tonight on (code ROOM_RESERVED)',
  })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
  ): Promise<RoomView> {
    return this.rooms.setActive(user, id, roomId, false);
  }

  @Patch('rooms/:roomId/reactivate')
  @ApiReq('HTL-06', 'Reactivate a room')
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiOkResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
  ): Promise<RoomView> {
    return this.rooms.setActive(user, id, roomId, true);
  }

  @Post('rooms/:roomId/availability')
  @ApiReq(
    'HTL-04',
    'Add a bookable date range',
    'The first and the last day (both included) when the room can be booked. Ranges of one room must not overlap.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiCreatedResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiBadRequestResponse({
    description:
      'Not a real date, end before start, or overlaps an existing range',
  })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  addAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: DateRangeDto,
  ): Promise<RoomView> {
    return this.rooms.addAvailability(user, id, roomId, dto);
  }

  @Patch('rooms/:roomId/availability')
  @ApiReq(
    ['HTL-05', 'HTL-06'],
    'Replace all bookable date ranges',
    "Sets the room's complete list of bookable ranges in one call (they must not overlap). Nights held by a Confirmed reservation or a live hold cannot be left out (409 AVAILABILITY_IN_USE). Blocked dates are managed with POST/DELETE .../blocks (HTL-06); single ranges with POST .../availability and PATCH/DELETE .../availability/:rangeId.",
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiOkResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Not a real date, end before start, or ranges overlap',
  })
  @ApiConflictResponse({
    description: 'A reservation holds a night the new ranges leave out',
  })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  replaceAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: ReplaceAvailabilityDto,
  ): Promise<RoomView> {
    return this.rooms.replaceAvailability(user, id, roomId, dto);
  }

  @Patch('rooms/:roomId/availability/:rangeId')
  @ApiReq(
    'HTL-05',
    'Change a bookable date range',
    'Move or resize a range. It cannot give up a night that a Confirmed reservation or a live hold holds (409 AVAILABILITY_IN_USE).',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiParam({ name: 'rangeId', description: 'Availability range id' })
  @ApiOkResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Not a real date, end before start, or overlaps another range',
  })
  @ApiConflictResponse({
    description: 'A reservation holds a night the change would remove',
  })
  @ApiNotFoundResponse({ description: 'Room or range not found' })
  updateAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Param('rangeId', ParseObjectIdPipe) rangeId: string,
    @Body() dto: DateRangeDto,
  ): Promise<RoomView> {
    return this.rooms.updateAvailability(user, id, roomId, rangeId, dto);
  }

  @Delete('rooms/:roomId/availability/:rangeId')
  @ApiReq(
    'HTL-05',
    'Remove a bookable date range',
    'Refused while a Confirmed reservation or a live hold holds one of its nights (409 AVAILABILITY_IN_USE). Returns the room.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiParam({ name: 'rangeId', description: 'Availability range id' })
  @ApiOkResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiConflictResponse({ description: 'A reservation holds one of its nights' })
  @ApiNotFoundResponse({ description: 'Room or range not found' })
  removeAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Param('rangeId', ParseObjectIdPipe) rangeId: string,
  ): Promise<RoomView> {
    return this.rooms.removeAvailability(user, id, roomId, rangeId);
  }

  @Post('rooms/:roomId/blocks')
  @ApiReq(
    'HTL-06',
    'Block a date range',
    'Takes the nights off the market (both days included). Refused if a Confirmed reservation or a live hold overlaps (409 ROOM_RESERVED).',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiCreatedResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Not a real date, end before start, or overlaps another block',
  })
  @ApiConflictResponse({ description: 'A reservation overlaps these dates' })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  block(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: DateRangeDto,
  ): Promise<RoomView> {
    return this.rooms.block(user, id, roomId, dto);
  }

  @Delete('rooms/:roomId/blocks/:blockId')
  @ApiReq(
    'HTL-06',
    'Lift a block',
    'Puts the blocked nights back on the market. Returns the room.',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiParam({ name: 'roomId', description: 'Room id' })
  @ApiParam({ name: 'blockId', description: 'Blocked range id' })
  @ApiOkResponse({ schema: { example: ROOM_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Room or block not found' })
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Param('blockId', ParseObjectIdPipe) blockId: string,
  ): Promise<RoomView> {
    return this.rooms.unblock(user, id, roomId, blockId);
  }

  @Get('availability')
  @ApiReq(
    'HTL-08',
    'Room status for a period',
    'One page of rooms (10 per page, GEN-05; total says how many), each night by night, between `from` and `to` (both included, at most 62 days): Available, Booked (with the reservation reference, null while it is an unpaid hold) or Blocked (with a reason: BLOCKED by the moderator, DEACTIVATED room, or NOT_OFFERED outside the availability ranges).',
  )
  @ApiParam({ name: 'id', description: 'Hotel id' })
  @ApiOkResponse({
    schema: {
      example: {
        hotelId: '665f1c2a9b1e8a0012345670',
        from: '2027-03-01',
        to: '2027-03-02',
        rooms: [
          {
            roomId: '665f1c2a9b1e8a0012345678',
            name: '101',
            nights: [
              { date: '2027-03-01', status: 'Available' },
              {
                date: '2027-03-02',
                status: 'Booked',
                reference: 'HTL-7KQ2M9XA',
                reservationId: '6660a1b2c3d4e5f601234567',
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Not a real date, end before start, or more than 62 days',
  })
  availability(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<AvailabilityView> {
    return this.rooms.availabilityView(user, id, query);
  }
}
