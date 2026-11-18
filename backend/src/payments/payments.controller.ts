import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ApiReq } from '../common/swagger/api-req.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';
import type { PaymentView } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import type { BookingType } from './refund.service.interface';

/** HTTP only; the logic lives in the services. */
@ApiTags('payments')
@ApiCookieAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly policies: PolicyAcceptanceService,
  ) {}

  @Post('payments')
  @Roles(Role.USER)
  @ApiReq(
    'PAY-01',
    'Start paying for a booking',
    'Creates (or reuses) a Stripe PaymentIntent in test mode for your own live 10-minute hold and returns its `clientSecret` for the browser to confirm. No card data reaches this API. Rejects expired holds (409 HOLD_EXPIRED) and unaccepted policies (409 POLICIES_NOT_ACCEPTED). The booking is confirmed only by the verified Stripe webhook.',
  )
  @ApiOkResponse({
    description: 'PaymentIntent client secret and payment record',
  })
  @ApiConflictResponse({
    description: 'Hold expired, already paid or policies not accepted',
  })
  @ApiNotFoundResponse({ description: 'Not your booking' })
  start(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentView> {
    return this.payments.start(user.id, dto.bookingType, dto.bookingId);
  }

  @Post('payments/webhook')
  @Public()
  @HttpCode(200)
  @ApiReq(
    'PAY-01',
    'Stripe webhook',
    'Called by Stripe only. Verifies the signature on the raw body, then confirms the booking (idempotent) or records the failure. Locally: `stripe listen --forward-to localhost:3000/api/payments/webhook`.',
  )
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    return this.payments.handleWebhook(req.rawBody, signature);
  }

  @Post('payments/:id/retry')
  @Roles(Role.USER)
  @ApiReq(
    'PAY-01',
    'Retry a payment',
    'Pay again after a failed attempt, until the hold expires.',
  )
  retry(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentView> {
    return this.payments.retry(user.id, id);
  }

  @Get('payments/:id')
  @Roles(Role.USER)
  @ApiReq(
    'PAY-01',
    'Payment status',
    'Your own payment only; another user gets 404.',
  )
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<PaymentView> {
    return this.payments.get(user.id, id);
  }

  @Get('bookings/:type/:id/policies')
  @Roles(Role.USER)
  @ApiParam({ name: 'type', enum: ['flight', 'hotel'] })
  @ApiReq(
    'PAY-02',
    'View the booking policies',
    'Flight: airline cancellation tiers and baggage rules. Hotel: cancellation tiers and stay dates. Your own booking only; another user gets 404. Shows whether you already accepted.',
  )
  policiesOf(
    @CurrentUser() user: AuthUser,
    @Param('type', new ParseEnumPipe(['flight', 'hotel'])) type: BookingType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): ReturnType<PolicyAcceptanceService['view']> {
    return this.policies.view(type, id, user.id);
  }

  @Post('bookings/:type/:id/accept-policies')
  @Roles(Role.USER)
  @HttpCode(200)
  @ApiParam({ name: 'type', enum: ['flight', 'hotel'] })
  @ApiReq(
    'PAY-02',
    'Accept the booking policies',
    'Stores your acceptance with a timestamp; payment is blocked until then.',
  )
  accept(
    @CurrentUser() user: AuthUser,
    @Param('type', new ParseEnumPipe(['flight', 'hotel'])) type: BookingType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<{
    bookingType: BookingType;
    bookingId: string;
    acceptedAt: Date;
  }> {
    return this.policies.accept(type, id, user.id);
  }
}
