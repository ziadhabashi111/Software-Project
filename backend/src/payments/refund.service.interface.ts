export const REFUND_SERVICE = Symbol('REFUND_SERVICE');

/**
 * What a payment or refund belongs to. `flight-change` is the fare difference
 * of a change to a Confirmed flight booking (FLT-27); its id is the change's.
 */
export type BookingType = 'flight' | 'hotel' | 'flight-change';

/** Every booking type, for validation and Swagger. */
export const BOOKING_TYPES: BookingType[] = [
  'flight',
  'hotel',
  'flight-change',
];
export type RefundStatus = 'PENDING' | 'FAILED' | 'REFUNDED';

export interface RefundPreview {
  refundPercent: number;
  refundAmount: number;
  currency: string;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  status: RefundStatus;
  currency: string;
  /** Stripe's short reason code when FAILED (never a message or secret). */
  failureReason?: string;
}

/** A result never moves a refund back from a final status to Pending. */
export const FINAL_REFUND_STATUSES: RefundStatus[] = ['REFUNDED', 'FAILED'];

/**
 * One refund of a known amount from one payment (FLT-27): a cheaper change's
 * fare difference, or one part of a cancellation refund when the booking was
 * paid with several payments. Recorded like any refund, so the refund
 * webhooks update it; safe to call twice (same idempotency key).
 */
export interface RefundPartRequest {
  kind: 'fare_difference' | 'cancellation_part';
  bookingType: BookingType;
  bookingId: string;
  userId: string;
  paymentIntentId: string;
  /** Major units. */
  amount: number;
  currency: string;
  percentage?: number;
  idempotencyKey: string;
}

export interface RefundService {
  preview(bookingType: BookingType, bookingId: string): Promise<RefundPreview>;
  issue(bookingType: BookingType, bookingId: string): Promise<RefundResult>;
  refundPart?(request: RefundPartRequest): Promise<RefundResult>;
}
