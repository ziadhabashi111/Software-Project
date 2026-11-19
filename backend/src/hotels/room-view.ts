import { formatDate } from '../hotel-bookings/stay-rules';
import type { RoomDocument, RoomRange } from './schemas/room.schema';

export interface RangeView {
  id: string;
  /** `YYYY-MM-DD`, included. */
  from: string;
  /** `YYYY-MM-DD`, included. */
  to: string;
}

/** What the API returns for a room (HTL-03, HTL-04, HTL-05, HTL-06). */
export interface RoomView {
  id: string;
  hotelId: string;
  name: string;
  type?: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  isActive: boolean;
  /** When the room can be booked, earliest first. */
  availability: RangeView[];
  /** Nights taken off the market, earliest first. */
  blocked: RangeView[];
}

const byStart = (a: RoomRange, b: RoomRange): number =>
  a.from.getTime() - b.from.getTime();

const toRangeView = (range: RoomRange): RangeView => ({
  id: range._id.toString(),
  from: formatDate(range.from),
  to: formatDate(range.to),
});

export function toRoomView(room: RoomDocument): RoomView {
  return {
    id: room.id,
    hotelId: room.hotel.toString(),
    name: room.name,
    ...(room.type ? { type: room.type } : {}),
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    pricePerNight: room.pricePerNight,
    isActive: room.isActive,
    availability: [...room.availability].sort(byStart).map(toRangeView),
    blocked: [...room.blocked].sort(byStart).map(toRangeView),
  };
}
