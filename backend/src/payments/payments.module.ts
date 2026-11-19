import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { BookingPaymentGateway } from './booking-payment-gateway';
import { PAYMENT_SERVICE } from './payment.service.interface';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { REFUND_SERVICE } from './refund.service.interface';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import {
  ProcessedStripeEvent,
  ProcessedStripeEventSchema,
} from './schemas/processed-stripe-event.schema';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema';
import { stripeProvider } from './stripe.provider';

/**
 * Owner: Ziad Mohannad (payments, refunds, policy acceptance)
 * Requirements: PAY-01..03
 *
 * PAY-01 lives here: PaymentIntents, retry, status and the Stripe webhook.
 * PAY-03: `RefundsService` (preview, issue through Stripe, refund webhook).
 * Booking modules find `PAYMENT_SERVICE` at runtime (no import cycle).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: ProcessedStripeEvent.name, schema: ProcessedStripeEventSchema },
    ]),
    FlightBookingsModule,
    HotelBookingsModule,
  ],
  controllers: [PaymentsController, RefundsController],
  providers: [
    stripeProvider,
    BookingPaymentGateway,
    PolicyAcceptanceService,
    RefundsService,
    PaymentsService,
    { provide: PAYMENT_SERVICE, useExisting: PaymentsService },
    { provide: REFUND_SERVICE, useExisting: RefundsService },
  ],
  exports: [PAYMENT_SERVICE, REFUND_SERVICE],
})
export class PaymentsModule {}
