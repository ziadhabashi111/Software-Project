import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../auth/auth.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { BookingRequestDto } from './dto/booking-request.dto';
import {
  BookingQuoteView,
  FlightBookingQuotesService,
} from './flight-booking-quotes.service';

/** Routes of PDF section 8.4 (Flight Booking). HTTP only; logic lives in the services. */
@ApiTags('flight-bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly quotes: FlightBookingQuotesService) {}

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
}
