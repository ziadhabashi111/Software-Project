import { formatDate } from './stay-rules';
import type { HotelReservationDocument } from './schemas/hotel-reservation.schema';
import { ReservationStatus } from './reservation-status';

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
  createdAt: string;
}

export function toReservationView(
  doc: HotelReservationDocument,
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
    status: doc.status,
    holdExpiresAt:
      doc.status === ReservationStatus.PENDING_PAYMENT && doc.holdExpiresAt
        ? doc.holdExpiresAt.toISOString()
        : null,
    createdAt: doc.createdAt.toISOString(),
  };
}
