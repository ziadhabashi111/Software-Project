import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { BookingPaymentGateway } from './booking-payment-gateway';
import { PAYMENT_SERVICE } from './payment.service.interface';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
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
 * Booking modules find `PAYMENT_SERVICE` at runtime (no import cycle).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
    ]),
    FlightBookingsModule,
    HotelBookingsModule,
  ],
  controllers: [PaymentsController],
  providers: [
    stripeProvider,
    BookingPaymentGateway,
    PolicyAcceptanceService,
    PaymentsService,
    { provide: PAYMENT_SERVICE, useExisting: PaymentsService },
  ],
  exports: [PAYMENT_SERVICE],
})
export class PaymentsModule {}
