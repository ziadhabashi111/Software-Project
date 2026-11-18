import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import type { AirlineView } from './airline-view';
import { AirlinesService } from './airlines.service';
import type { Paginated } from '../common/pagination/pagination';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CancellationPolicyDto } from './dto/cancellation-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { ListAirlineFlightsQueryDto } from './dto/list-airline-flights.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { FlightsService } from './flights.service';
import type { FlightView } from './flight-view';

const AIRLINE_EXAMPLE = {
  id: '665f1c2a9b1e8a0012345670',
  name: 'EgyptAir',
  code: 'MS',
  logoUrl: null,
  isActive: true,
  baggagePolicy: { extraBagPrice: 25, maxExtraBags: 2 },
  cancellationPolicy: [
    { daysBefore: 14, refundPercent: 100 },
    { daysBefore: 3, refundPercent: 50 },
  ],
};

@ApiTags('airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(
    private readonly airlines: AirlinesService,
    private readonly flights: FlightsService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-01',
    'Create an airline (admin)',
    'Creates the airline profile. Create its moderator afterwards with POST /api/admin/moderators (ACC-13), which links the moderator to this airline.',
  )
  @ApiCreatedResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Invalid name or code' })
  @ApiConflictResponse({
    description: 'Another airline already uses this code',
  })
  @ApiForbiddenResponse({ description: 'Only admins create airlines' })
  create(@Body() dto: CreateAirlineDto): Promise<AirlineView> {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiReq(
    'FLT-01',
    'Get an airline',
    'Public for active airlines. A deactivated airline is hidden (404) except from admins and its own moderator.',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiNotFoundResponse({ description: 'Airline not found or deactivated' })
  get(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user?: AuthUser,
  ): Promise<AirlineView> {
    return this.airlines.get(id, user);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-01',
    'Edit own airline profile (moderator)',
    'Edits name, code or logo of the moderator’s own airline. The logo is the URL returned by the upload helper (one logo, JPG or PNG up to 5 MB).',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({ description: 'Invalid name, code or logo URL' })
  @ApiConflictResponse({
    description: 'Another airline already uses this code',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAirlineDto,
  ): Promise<AirlineView> {
    return this.airlines.update(id, user, dto);
  }

  @Put(':id/baggage-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-08',
    'Set the baggage policy (moderator)',
    'Price per extra bag (> 0) and the most extra bags one passenger can add (>= 0). Each extra bag has the same maximum weight as the cabin’s free baggage allowance (FLT-04).',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Price not above 0 or negative bag count',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  setBaggagePolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: BaggagePolicyDto,
  ): Promise<AirlineView> {
    return this.airlines.setBaggagePolicy(id, user, dto);
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-09',
    'Set the cancellation policy (moderator)',
    'Replaces the tiers. Each tier has a unique days-before-departure threshold (whole number >= 0) and a refund percentage (0-100). A cancellation uses the tier with the highest threshold not exceeding the days remaining; if none applies the refund is 0%.',
  )
  @ApiOkResponse({ schema: { example: AIRLINE_EXAMPLE } })
  @ApiBadRequestResponse({
    description:
      'Duplicate threshold, negative days or a percentage outside 0-100',
  })
  @ApiForbiddenResponse({ description: 'Not the moderator of this airline' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  setCancellationPolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancellationPolicyDto,
  ): Promise<AirlineView> {
    return this.airlines.setCancellationPolicy(id, user, dto);
  }

  @Get(':id/flights')
  @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
  @ApiCookieAuth()
  @ApiReq(
    'FLT-05',
    'List the airline’s flights (own moderator or admin)',
    'Newest departure first, paginated (10 per page). Filter with `status` (Scheduled, Cancelled or Departed; Departed also covers flights whose departure time has passed). Each flight has the same shape as GET /api/flights/:id: local times, cabins and seats remaining. Use it to find the ids for editing (FLT-05), cancelling (FLT-06) and the bookings views (FLT-29).',
  )
  @ApiOkResponse({
    schema: {
      example: {
        items: [
          {
            id: '6660a1b2c3d4e5f601234567',
            airline: {
              id: '665f1c2a9b1e8a0012345670',
              name: 'EgyptAir',
              code: 'MS',
            },
            flightNumber: 'MS985',
            status: 'Scheduled',
            departure: {
              airport: {
                iataCode: 'CAI',
                name: 'Cairo International Airport',
                cityId: 'cairo',
                timeZone: 'Africa/Cairo',
              },
              utc: '2027-03-01T12:30:00.000Z',
              localDate: '2027-03-01',
              localTime: '14:30',
              utcOffset: '+02:00',
            },
            arrival: {
              airport: {
                iataCode: 'JFK',
                name: 'John F. Kennedy International Airport',
                cityId: 'new_york',
                timeZone: 'America/New_York',
              },
              utc: '2027-03-02T00:45:00.000Z',
              localDate: '2027-03-01',
              localTime: '19:45',
              utcOffset: '-05:00',
            },
            durationMinutes: 735,
            cabins: [],
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Unknown status value' })
  @ApiForbiddenResponse({
    description: 'Only this airline’s own moderator or an admin',
  })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  listFlights(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Query() query: ListAirlineFlightsQueryDto,
  ): Promise<Paginated<FlightView>> {
    return this.flights.listForAirline(user, id, query);
  }
}
