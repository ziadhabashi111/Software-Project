import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { fieldError } from '../common/validation/validation-errors';
import { normalizeTiers } from '../flights/airline-policies';
import { HotelRatings } from '../hotel-bookings/hotel-ratings';
import { PlaceCatalog } from '../itineraries/places';
import { assertOwnHotel, isOwnHotelModerator } from './hotel-access';
import { toHotelView } from './hotel-view';
import type { HotelView } from './hotel-view';
import type { CreateHotelDto } from './dto/create-hotel.dto';
import type { HotelPoliciesDto } from './dto/hotel-policies.dto';
import type { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel } from './schemas/hotel.schema';
import type { HotelDocument } from './schemas/hotel.schema';

type Caller = Pick<AuthUser, 'id' | 'role' | 'providerId'>;

/** Drops the fields that were not sent, so an edit never overwrites with `undefined`. */
function defined<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * The hotel's profile and policies: HTL-01 (an admin creates a hotel, its
 * moderator edits it), HTL-02 (the public hotel page), HTL-09 (check-in and
 * check-out times) and HTL-10 (cancellation tiers). A moderator manages only
 * the hotel they are linked to.
 */
@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly places: PlaceCatalog,
    private readonly ratings: HotelRatings,
  ) {}

  /** HTL-01: the admin creates the profile; its moderator is created afterwards (ACC-13). */
  async create(dto: CreateHotelDto): Promise<HotelView> {
    await this.assertPlace(dto.city, dto.country);
    const hotel = await this.hotels.create({
      name: dto.name,
      address: dto.address,
      city: dto.city,
      country: dto.country,
      ...(dto.description ? { description: dto.description } : {}),
      starClass: dto.starClass,
      amenities: dto.amenities ?? [],
    });
    return this.view(hotel);
  }

  /**
   * HTL-02: the hotel page, open to everyone. A deactivated hotel is hidden
   * (404) except from admins and its own moderator (ACC-15).
   */
  async get(id: string, user?: Caller): Promise<HotelView> {
    const hotel = Types.ObjectId.isValid(id)
      ? await this.hotels.findById(id)
      : null;
    const canSeeInactive =
      user?.role === Role.ADMIN || isOwnHotelModerator(user, id);
    if (!hotel || (!hotel.isActive && !canSeeInactive)) {
      throw new NotFoundException('Hotel not found');
    }
    return this.view(hotel);
  }

  /** HTL-01: the hotel's own moderator edits the profile. */
  async update(
    user: Caller,
    id: string,
    dto: UpdateHotelDto,
  ): Promise<HotelView> {
    assertOwnHotel(user, id);
    const changes = defined(dto);
    if (Object.keys(changes).length === 0) {
      throw fieldError('body', 'Send at least one field to change');
    }
    if (changes.city !== undefined || changes.country !== undefined) {
      await this.assertPlace(changes.city, changes.country);
    }
    return this.apply(id, changes);
  }

  /** HTL-09, HTL-10: standard check-in and check-out times, and the cancellation tiers. */
  async setPolicies(
    user: Caller,
    id: string,
    dto: HotelPoliciesDto,
  ): Promise<HotelView> {
    assertOwnHotel(user, id);
    if (
      dto.checkInTime === undefined &&
      dto.checkOutTime === undefined &&
      dto.tiers === undefined
    ) {
      throw fieldError(
        'body',
        'Send check-in and check-out times and/or tiers',
      );
    }
    return this.apply(
      id,
      defined({
        checkInTime: dto.checkInTime,
        checkOutTime: dto.checkOutTime,
        cancellationTiers:
          dto.tiers === undefined ? undefined : normalizeTiers(dto.tiers),
      }),
    );
  }

  private async apply(id: string, changes: Partial<Hotel>): Promise<HotelView> {
    const hotel = Types.ObjectId.isValid(id)
      ? await this.hotels.findByIdAndUpdate(
          id,
          { $set: changes },
          { returnDocument: 'after', runValidators: true },
        )
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found');
    return this.view(hotel);
  }

  private async view(hotel: HotelDocument): Promise<HotelView> {
    return toHotelView(hotel, await this.ratings.forHotel(hotel.id));
  }

  /** City and country must come from the predefined lists once they are loaded (GEN-12). */
  private async assertPlace(city?: string, country?: string): Promise<void> {
    const lists = this.places.get();
    if (!lists) return;
    if (city !== undefined && !(await lists.isCity(city))) {
      throw fieldError('city', `${city} is not a supported city`);
    }
    if (country !== undefined && !(await lists.isCountry(country))) {
      throw fieldError('country', `${country} is not a supported country`);
    }
  }
}
