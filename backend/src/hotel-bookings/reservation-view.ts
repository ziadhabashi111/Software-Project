import { ReservationStatus } from './reservation-status';
import type { HotelReservationDocument } from './schemas/hotel-reservation.schema';
import { formatDate, startOfUtcDay } from './stay-rules';

export interface ReservedRoomView {
  roomId: string;
  name: string;
  type?: string;
  adults: number;
  childrenAges: number[];
  pricePerNight: number;
  subtotal: number;
}

/** What the API returns for a reservation. */
export interface HotelReservationView {
  id: string;
  /** Assigned on confirmation (HTL-17); null before. */
  reference: string | null;
  hotel: { id: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: ReservedRoomView[];
  guests: { adults: number; children: number };
  totalPrice: number;
  currency: string;
  status: ReservationStatus;
  /** Only while Pending Payment: pay before this moment (HTL-18). */
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  /** Stripe payment status, amount and currency only (PAY-01). */
  payment: { status: string; amount?: number; currency?: string } | null;
  /** Refund after a cancellation (HTL-21, PAY-03). */
  refund: {
    status: string;
    amount?: number;
    percentage?: number;
    currency?: string;
  } | null;
  createdAt: string;
}

/**
 * The status as the user should see it right now. The background jobs move
 * reservations along within a few minutes; until they do, an unpaid hold
 * past its expiry already reads Expired and a Confirmed stay whose check-out
 * date has passed already reads Completed (GEN-11).
 */
export function effectiveStatus(
  doc: Pick<HotelReservationDocument, 'status' | 'holdExpiresAt' | 'checkOut'>,
  now: Date,
): ReservationStatus {
  if (
    doc.status === ReservationStatus.PENDING_PAYMENT &&
    doc.holdExpiresAt &&
    doc.holdExpiresAt.getTime() <= now.getTime()
  ) {
    return ReservationStatus.EXPIRED;
  }
  if (
    doc.status === ReservationStatus.CONFIRMED &&
    doc.checkOut.getTime() < startOfUtcDay(now).getTime()
  ) {
    return ReservationStatus.COMPLETED;
  }
  return doc.status;
}

const iso = (date?: Date): string | null => (date ? date.toISOString() : null);

export function toReservationView(
  doc: HotelReservationDocument,
  now: Date = new Date(),
): HotelReservationView {
  const rooms = doc.rooms.map((room): ReservedRoomView => ({
    roomId: room.room.toString(),
    name: room.name,
    ...(room.type ? { type: room.type } : {}),
    adults: room.adults,
    childrenAges: [...room.childrenAges],
    pricePerNight: room.pricePerNight,
    subtotal: room.subtotal,
  }));
  const status = effectiveStatus(doc, now);
  return {
    id: doc.id,
    reference: doc.reference ?? null,
    hotel: { id: doc.hotel.toString(), name: doc.hotelName },
    checkIn: formatDate(doc.checkIn),
    checkOut: formatDate(doc.checkOut),
    nights: doc.nights,
    rooms,
    guests: {
      adults: rooms.reduce((sum, room) => sum + room.adults, 0),
      children: rooms.reduce((sum, room) => sum + room.childrenAges.length, 0),
    },
    totalPrice: doc.totalPrice,
    currency: doc.currency,
    status,
    holdExpiresAt:
      status === ReservationStatus.PENDING_PAYMENT
        ? iso(doc.holdExpiresAt)
        : null,
    confirmedAt: iso(doc.confirmedAt),
    cancelledAt: iso(doc.cancelledAt),
    payment: doc.payment?.status
      ? {
          status: doc.payment.status,
          ...(doc.payment.amount !== undefined
            ? { amount: doc.payment.amount }
            : {}),
          ...(doc.payment.currency ? { currency: doc.payment.currency } : {}),
        }
      : null,
    refund: doc.refund?.status
      ? {
          status: doc.refund.status,
          ...(doc.refund.amount !== undefined
            ? { amount: doc.refund.amount }
            : {}),
          ...(doc.refund.percentage !== undefined
            ? { percentage: doc.refund.percentage }
            : {}),
          ...(doc.refund.currency ? { currency: doc.refund.currency } : {}),
        }
      : null,
    createdAt: doc.createdAt.toISOString(),
  };
}
