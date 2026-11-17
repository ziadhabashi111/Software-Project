import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
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
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { CreateCabinDto } from './dto/create-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { FlightsService } from './flights.service';
import type { FlightView } from './flight-view';

const FLIGHT_EXAMPLE = {
  id: '6660a1b2c3d4e5f601234567',
  airline: { id: '665f1c2a9b1e8a0012345670', name: 'EgyptAir', code: 'MS' },
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
  cabins: [
    {
      id: '6660a1b2c3d4e5f601234999',
      cabinClass: 'Economy',
      price: 420,
      totalSeats: 150,
      seatsRemaining: 150,
      freeBags: 1,
      maxBagWeightKg: 23,
    },
  ],
};

@ApiTags('flights')
@ApiCookieAuth()
@Roles(Role.AIRLINE_MODERATOR)
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post()
  @ApiReq(
    ['FLT-03', 'FLT-30'],
    'Create a flight (airline moderator)',
    'Creates a Scheduled flight for the moderator’s own airline. Departure and arrival times are entered in each airport’s local time (YYYY-MM-DDTHH:mm) and stored in UTC. Rejected: an airport not in GET /api/airports, identical airports, arrival not after departure (compared in UTC), a departure in the past, a local time that does not exist (clock change), and a duplicate flight number for the same airline on the same local departure date (409). Add cabins next with POST /api/flights/:id/cabins.',
  )
  @ApiCreatedResponse({
    schema: { example: { ...FLIGHT_EXAMPLE, cabins: [] } },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (see errors per field)',
  })
  @ApiConflictResponse({ description: 'Duplicate flight number on that date' })
  @ApiForbiddenResponse({
    description: 'Only airline moderators create flights',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFlightDto,
  ): Promise<FlightView> {
    return this.flights.create(user, dto);
  }

  @Patch(':id')
  @ApiReq(
    ['FLT-05', 'FLT-30'],
    'Edit a Scheduled flight (own airline)',
    'Changes departure and/or arrival time (local, as when creating). Airports can change only while the flight has no booking or hold (409 AIRPORTS_LOCKED). Passengers with Confirmed bookings are notified of any time change. Cabin prices and seat counts are edited with PATCH /api/flights/:id/cabins/:cabinId. Only Scheduled flights can be edited.',
  )
  @ApiOkResponse({ schema: { example: FLIGHT_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Validation failed (see errors per field)',
  })
  @ApiConflictResponse({
    description:
      'Airports locked by a booking, flight not Scheduled, or duplicate flight number',
  })
  @ApiForbiddenResponse({
    description: 'Not the moderator of this flight’s airline',
  })
  @ApiNotFoundResponse({ description: 'Flight not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateFlightDto,
  ): Promise<FlightView> {
    return this.flights.update(id, user, dto);
  }

  @Post(':id/cabins')
  @ApiReq(
    'FLT-04',
    'Add a cabin to a flight (own airline)',
    'Cabin class from {Economy, Premium Economy, Business, First}, each at most once per flight; seats (whole number > 0), price (> 0), free bags and maximum weight per bag in kg (> 0).',
  )
  @ApiCreatedResponse({ schema: { example: FLIGHT_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Validation failed (see errors per field)',
  })
  @ApiConflictResponse({
    description: 'This cabin already exists, or the flight is not Scheduled',
  })
  @ApiForbiddenResponse({
    description: 'Not the moderator of this flight’s airline',
  })
  @ApiNotFoundResponse({ description: 'Flight not found' })
  addCabin(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCabinDto,
  ): Promise<FlightView> {
    return this.flights.addCabin(id, user, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @ApiReq(
    ['FLT-04', 'FLT-05'],
    'Edit a cabin’s price, seats or baggage (own airline)',
    'Price changes do not affect existing bookings. The seat count cannot drop below the seats already booked or held (409 SEATS_BELOW_BOOKED); this is checked atomically with seat holds.',
  )
  @ApiOkResponse({ schema: { example: FLIGHT_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Validation failed (see errors per field)',
  })
  @ApiConflictResponse({
    description: 'Seats below booked + held, or the flight is not Scheduled',
  })
  @ApiForbiddenResponse({
    description: 'Not the moderator of this flight’s airline',
  })
  @ApiNotFoundResponse({ description: 'Flight or cabin not found' })
  updateCabin(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('cabinId', ParseObjectIdPipe) cabinId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCabinDto,
  ): Promise<FlightView> {
    return this.flights.updateCabin(id, cabinId, user, dto);
  }
}
