import { Injectable } from '@nestjs/common';

/** What the booking module needs to know about a hotel. */
export interface InventoryHotel {
  id: string;
  name: string;
  /** False when an admin deactivated the hotel (ACC-15): it cannot be booked. */
  active: boolean;
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
