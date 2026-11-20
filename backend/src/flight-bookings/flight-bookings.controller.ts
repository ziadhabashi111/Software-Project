import { HOLD_MINUTES } from '../common/booking-status/hold';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
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
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { BookingRequestDto } from './dto/booking-request.dto';
import { CancelFlightBookingDto } from './dto/cancel-flight-booking.dto';
import { ListFlightBookingsDto } from './dto/list-flight-bookings.dto';
import {
  CancellationResult,
  FlightBookingCancellationsService,
} from './flight-booking-cancellations.service';
import { PickSeatDto } from './dto/seat.dto';
import { FlightBookingHoldsService } from './flight-booking-holds.service';
import {
  BookingQuoteView,
  FlightBookingQuotesService,
} from './flight-booking-quotes.service';
import type { FlightBookingView } from './flight-booking-view';
import { MyFlightBookingsService } from './my-flight-bookings.service';
import { SeatSelectionService } from './seat-selection.service';

/** Routes of PDF section 8.4 (Flight Booking). HTTP only; logic lives in the services. */
@ApiTags('flight-bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly quotes: FlightBookingQuotesService,
    private readonly holds: FlightBookingHoldsService,
    private readonly mine: MyFlightBookingsService,
    private readonly cancellations: FlightBookingCancellationsService,
    private readonly seatSelection: SeatSelectionService,
  ) {}

  @Post()
  @Roles(Role.USER)
  @HttpCode(200)
  @ApiReq(
    ['FLT-19', 'FLT-21', 'FLT-12'],
    'Booking summary (no seats held)',
    "Enter each passenger (full name, date of birth, passport/ID number, type) and optional extra bags with their weight, for a one-way flight or a round trip (`return`). Returns the summary shown before payment: each flight in its airports' local time, each passenger with their fare (infants pay 10% and take no seat) and baggage fee (charged on every flight), the total in the platform currency, and the airline policies to accept (PAY-02). The passenger type must match the date of birth on the outbound's local departure date (adult 12+, child 2-11, infant under 2); at least one adult, no more infants than adults, at most 9 passengers. Nothing is stored and no seat is held: call `POST /api/flight-bookings/hold` to proceed to payment.",
  )
  @ApiOkResponse({ description: 'The booking summary' })
  @ApiBadRequestResponse({
    description:
      'Invalid passengers, baggage, cabin, or a flight that cannot be booked (field errors)',
  })
  @ApiForbiddenResponse({ description: 'Only registered users can book' })
  summary(@Body() dto: BookingRequestDto): Promise<BookingQuoteView> {
    return this.quotes.quote(dto);
  }

  @Post('hold')
  @Roles(Role.USER)
  @ApiReq(
    ['FLT-22', 'FLT-12'],
    `Proceed to payment: hold the seats for ${HOLD_MINUTES} minutes`,
    `Same body and checks as the booking summary. Atomically reserves the seats (adults + children; infants take none) on every chosen flight only if enough remain, and creates one booking in Pending Payment status, held for ${HOLD_MINUTES} minutes. A round trip is one booking: if either flight lacks seats, nothing is held (409 SEATS_UNAVAILABLE). Concurrent requests never hold more seats than exist. Pay within the hold (PAY-01); otherwise the booking becomes Expired and the seats are released. Prices are fixed at this moment.`,
  )
  @ApiCreatedResponse({
    description: 'The Pending Payment booking with its hold expiry',
  })
  @ApiBadRequestResponse({ description: 'Invalid request (field errors)' })
  @ApiConflictResponse({
    description: 'SEATS_UNAVAILABLE: not enough seats left',
  })
  @ApiForbiddenResponse({ description: 'Only registered users can book' })
  hold(
    @CurrentUser() user: AuthUser,
    @Body() dto: BookingRequestDto,
  ): Promise<FlightBookingView> {
    return this.holds.hold(user, dto);
  }

  @Get()
  @Roles(Role.USER)
  @ApiReq(
    'FLT-25',
    'My flight bookings (Upcoming, Past, Cancelled)',
    'Your own flight bookings in one group, newest first, 10 per page by default. Each item shows the reference (once Confirmed), the flights with local dates and times, passengers, cabin and status. Upcoming: unpaid holds still running and Confirmed bookings. Past: Completed and Expired. Cancelled: Cancelled.',
  )
  @ApiOkResponse({ description: 'One page: { items, total, page, limit }' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListFlightBookingsDto,
  ): Promise<Paginated<FlightBookingView>> {
    return this.mine.list(user, query);
  }

  @Get(':id')
  @Roles(Role.USER, Role.ADMIN)
  @ApiParam({ name: 'id', description: 'Flight booking id' })
  @ApiReq(
    ['FLT-25', 'PAY-01', 'PAY-03', 'GEN-06'],
    'Flight booking details',
    "Full details of your own booking (admins can open any): flights in each airport's local time, passengers and baggage, price, accepted policies, payment status and refund status (Pending, Refunded, Failed). While the booking can be cancelled, `cancellation` shows the refund you would get now (FLT-26). Another user's booking answers 404.",
  )
  @ApiOkResponse({ description: 'The booking' })
  @ApiNotFoundResponse({ description: 'No such booking, or not yours' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightBookingView> {
    return this.mine.get(id, user);
  }

  @Post(':id/cancel')
  @Roles(Role.USER)
  @HttpCode(200)
  @ApiParam({ name: 'id', description: 'Flight booking id' })
  @ApiReq(
    ['FLT-26', 'PAY-03', 'FLT-12'],
    'Cancel my booking (see the refund first)',
    "Cancel your own Confirmed booking any time before the outbound flight departs; a round trip is cancelled as a whole. Without `confirm: true` nothing changes and you get the refund you would receive now: the outbound airline's tier with the highest days-before threshold not above the whole days left, applied to the total (0% if no tier applies). With `confirm: true` the booking becomes Cancelled, its seats return to inventory and a refund is created (status Pending, then Refunded or Failed), and you get an in-app notification. 409 ALREADY_DEPARTED after departure, NOT_CANCELLABLE if the booking is not Confirmed.",
  )
  @ApiOkResponse({
    description: '{ cancelled, preview, booking?, message }',
  })
  @ApiConflictResponse({ description: 'ALREADY_DEPARTED or NOT_CANCELLABLE' })
  @ApiNotFoundResponse({ description: 'No such booking, or not yours' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancelFlightBookingDto,
  ): Promise<CancellationResult> {
    return this.cancellations.cancel(id, user, dto.confirm === true);
  }

  @Patch(':id/seat')
  @Roles(Role.USER)
  @ApiParam({ name: 'id', description: 'Flight booking id' })
  @ApiReq(
    'FLT-28',
    'Pick a seat for a passenger',
    'Choose a seat for one passenger of your own Confirmed booking on one of its flights (`segmentIndex` 0 = outbound, 1 = return; default 0). Picking again moves the passenger to the new seat. Infants have no seat of their own. See the seat map at GET /api/flights/:id/seats. 400 when the seat does not exist in that cabin; 409 SEAT_TAKEN when someone else has it, NOT_CONFIRMED before payment, SEAT_CHANGE_CLOSED once the flight is cancelled or has departed. Seats are freed when the booking is cancelled.',
  )
  @ApiOkResponse({
    description: "The booking, with each passenger's seats",
  })
  @ApiBadRequestResponse({
    description: 'No such seat, passenger or flight in the booking',
  })
  @ApiConflictResponse({
    description: 'SEAT_TAKEN, NOT_CONFIRMED or SEAT_CHANGE_CLOSED',
  })
  @ApiNotFoundResponse({ description: 'No such booking, or not yours' })
  pickSeat(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: PickSeatDto,
  ): Promise<FlightBookingView> {
    return this.seatSelection.pick(id, user, dto);
  }

  @Get(':id/e-ticket')
  @Roles(Role.USER)
  @ApiParam({ name: 'id', description: 'Flight booking id' })
  @ApiProduces('application/pdf')
  @ApiReq(
    ['FLT-23', 'GEN-06'],
    'Download my e-ticket (PDF)',
    "The e-ticket of your own Confirmed (or Completed) booking: booking reference, passengers with their document numbers and extra bags, and each flight with departure and arrival in the airports' local time (with UTC offset and time zone), cabin and baggage allowance. 409 TICKET_NOT_AVAILABLE before the booking is Confirmed.",
  )
  @ApiOkResponse({ description: 'A PDF file download' })
  @ApiConflictResponse({ description: 'TICKET_NOT_AVAILABLE' })
  @ApiNotFoundResponse({ description: 'No such booking, or not yours' })
  async eTicket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.mine.eTicket(id, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    return new StreamableFile(pdf);
  }
}
