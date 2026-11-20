import { Injectable } from '@nestjs/common';

/** What the booking module needs to know about a hotel. */
export interface InventoryHotel {
  id: string;
  name: string;
  /** False when an admin deactivated the hotel (ACC-15): it cannot be booked. */
  active: boolean;
  /**
   * The hotel's cancellation tiers (HTL-10): refund percentage (0-100) from
   * a number of whole days before check-in. Copied onto each reservation when
   * it is made, so the refund follows the policy the guest accepted.
   */
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
  /** The hotel's standard check-in time, `HH:mm` (HTL-09); shown with its policies (PAY-02). */
  checkInTime?: string;
  /** The hotel's standard check-out time, `HH:mm` (HTL-09). */
  checkOutTime?: string;
}

/** One room as it is right now, for the requested stay. */
export interface InventoryRoom {
  id: string;
  hotelId: string;
  /** Room number or name, unique within the hotel (HTL-03). */
  name: string;
  type?: string;
  maxOccupancy: number;
  pricePerNight: number;
  /**
   * True only when the room is active, every night of the stay is inside one
   * of its availability ranges (HTL-04) and none is blocked (HTL-06).
   * Other reservations are checked by the booking module itself.
   */
  bookable: boolean;
}

/**
 * Implemented by the hotels module (Abdelrahman) and registered once:
 *
 *   constructor(inventory: HotelInventoryRegistry) {}
 *   onModuleInit() { this.inventory.register(this); }
 *
 * `checkIn` and `checkOut` are midnight-UTC calendar dates; the stay covers
 * the nights from `checkIn` up to, not including, `checkOut`.
 */
export interface HotelInventory {
  findHotel(hotelId: string): Promise<InventoryHotel | null>;
  /** The requested rooms that belong to `hotelId` (others are left out). */
  findRooms(
    hotelId: string,
    roomIds: string[],
    stay: { checkIn: Date; checkOut: Date },
  ): Promise<InventoryRoom[]>;
}

@Injectable()
export class HotelInventoryRegistry {
  private inventory?: HotelInventory;

  register(inventory: HotelInventory): void {
    this.inventory = inventory;
  }

  /** `undefined` until the hotels module has registered. */
  get(): HotelInventory | undefined {
    return this.inventory;
  }
}
