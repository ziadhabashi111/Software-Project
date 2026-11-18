export const REFUND_SERVICE = Symbol('REFUND_SERVICE');

export type BookingType = 'flight' | 'hotel';
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
}

export interface RefundService {
  preview(bookingType: BookingType, bookingId: string): Promise<RefundPreview>;
  issue(bookingType: BookingType, bookingId: string): Promise<RefundResult>;
}
