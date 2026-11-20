import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProviderDirectory, ProviderType } from '../admin/provider-directory';
import type {
  ProviderChange,
  ProviderHandler,
} from '../admin/provider-directory';
import { HotelInventoryRegistry } from '../hotel-bookings/hotel-inventory';
import type {
  HotelInventory,
  InventoryHotel,
  InventoryRoom,
} from '../hotel-bookings/hotel-inventory';
import { HotelReservationQueries } from '../hotel-bookings/hotel-reservation-queries';
import { roomBookable } from './date-ranges';
import { Hotel } from './schemas/hotel.schema';
import { Room } from './schemas/room.schema';

/**
 * The hotel catalogue as the rest of the platform sees it:
 * - the booking module's `HotelInventory` (HTL-16, HTL-18): is a hotel active,
 *   what are its cancellation tiers, which of these rooms can be booked for
 *   this stay. Registering it is what makes `POST /api/hotel-bookings` work;
 * - the admin's `ProviderHandler` (ACC-13, ACC-15): a hotel can be checked
 *   when a moderator is linked to it, and deactivated or reactivated.
 */
@Injectable()
export class HotelCatalog
  implements HotelInventory, ProviderHandler, OnModuleInit
{
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    private readonly inventory: HotelInventoryRegistry,
    private readonly directory: ProviderDirectory,
    private readonly reservations: HotelReservationQueries,
  ) {}

  onModuleInit(): void {
    this.inventory.register(this);
    this.directory.register(ProviderType.HOTEL, this);
  }

  // HotelInventory ------------------------------------------------------

  async findHotel(hotelId: string): Promise<InventoryHotel | null> {
    if (!Types.ObjectId.isValid(hotelId)) return null;
    const hotel = await this.hotels.findById(hotelId);
    if (!hotel) return null;
    return {
      id: hotel.id,
      name: hotel.name,
      active: hotel.isActive,
      cancellationTiers: hotel.cancellationTiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
    };
  }

  async findRooms(
    hotelId: string,
    roomIds: string[],
    stay: { checkIn: Date; checkOut: Date },
  ): Promise<InventoryRoom[]> {
    const ids = roomIds.filter((id) => Types.ObjectId.isValid(id));
    if (!Types.ObjectId.isValid(hotelId) || ids.length === 0) return [];
    const rooms = await this.rooms.find({
      hotel: new Types.ObjectId(hotelId),
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    return rooms.map((room) => ({
      id: room.id,
      hotelId,
      name: room.name,
      ...(room.type ? { type: room.type } : {}),
      maxOccupancy: room.maxOccupancy,
      pricePerNight: room.pricePerNight,
      bookable: roomBookable(room, stay.checkIn, stay.checkOut),
    }));
  }

  // ProviderHandler -----------------------------------------------------

  async exists(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    return (await this.hotels.exists({ _id: id })) !== null;
  }

  async setActive(id: string, active: boolean): Promise<ProviderChange | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const hotel = await this.hotels.findById(id);
    if (!hotel) return null;
    const changed = hotel.isActive !== active;
    if (changed) {
      hotel.isActive = active;
      await hotel.save();
    }
    // Guests with a Confirmed stay keep it, and are told about the change.
    return {
      name: hotel.name,
      changed,
      affectedUserIds: await this.reservations.confirmedGuestIds(hotel.id),
    };
  }
}
