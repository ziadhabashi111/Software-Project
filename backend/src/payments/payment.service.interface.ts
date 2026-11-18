import type { BookingType } from './refund.service.interface';

/** Injection token for the payment service (PAY-01). */
export const PAYMENT_SERVICE = Symbol('PAYMENT_SERVICE');

export interface PaymentService {
  /**
   * Cancels the open Stripe PaymentIntent for a booking. Call it when a
   * Pending Payment hold expires so the user can no longer pay for it.
   */
  cancelPendingPayment(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<void>;
}
