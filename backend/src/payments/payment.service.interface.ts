import type { BookingType } from './refund.service.interface';

/** Injection token for the payment service (PAY-01). */
export const PAYMENT_SERVICE = Symbol('PAYMENT_SERVICE');

/**
 * What happened to a booking's open PaymentIntent when its hold ended:
 * - `cancelled`: it can no longer be paid (or already could not be).
 * - `none`: there was no PaymentIntent for this booking.
 * - `not_cancellable`: the user already paid (or the payment is processing).
 *   Do not expire the hold yet: the `payment_intent.succeeded` webhook
 *   confirms the booking or refunds the payment.
 * - `error`: Stripe could not be reached; the caller decides.
 */
export type PendingPaymentCancellation =
  | 'cancelled'
  | 'none'
  | 'not_cancellable'
  | 'error';

export interface PaymentService {
  /**
   * Cancels the open Stripe PaymentIntent for a booking. Call it when a
   * Pending Payment hold expires so the user can no longer pay for it.
   * Never throws.
   */
  cancelPendingPayment(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<PendingPaymentCancellation>;
}
