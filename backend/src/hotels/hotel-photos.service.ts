import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { HotelRatings } from '../hotel-bookings/hotel-ratings';
import { IMAGE_LIMITS } from '../uploads/image-rules';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.service';
import { assertOwnHotel } from './hotel-access';
import { toHotelView } from './hotel-view';
import type { HotelView } from './hotel-view';
import { Hotel } from './schemas/hotel.schema';

type Caller = Pick<AuthUser, 'id' | 'role' | 'providerId'>;

/**
 * HTL-01 / GEN-08: photos of a hotel, through the shared upload helper (JPG or
 * PNG, at most 5 MB each and 5 per hotel). Only the hotel's own moderator can
 * add or remove them. The files belong to the moderator who uploaded them (the
 * upload helper's ownership rule), and are deleted when the photo is removed.
 */
@Injectable()
export class HotelPhotosService {
  private readonly logger = new Logger(HotelPhotosService.name);

  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    private readonly uploads: UploadsService,
    private readonly ratings: HotelRatings,
  ) {}

  async add(
    user: Caller,
    hotelId: string,
    files: ImageFile[] | undefined,
  ): Promise<HotelView> {
    // Someone else's hotel is refused before a single file is written.
    assertOwnHotel(user, hotelId);
    const hotel = await this.find(hotelId);

    // Validates every file and the limit, then stores all or none.
    const stored = await this.uploads.saveImages(
      files,
      'hotel',
      user.id,
      hotel.photos.length,
    );
    const urls = stored.map((image) => image.url);
    try {
      // The limit is part of the write: `photos.<limit - n>` exists only when
      // the hotel already holds more than `limit - n` photos, so two parallel
      // uploads can never both fit.
      const updated = await this.hotels.findOneAndUpdate(
        {
          _id: hotelId,
          [`photos.${IMAGE_LIMITS.hotel - stored.length}`]: { $exists: false },
        },
        { $push: { photos: { $each: urls.map((url) => ({ url })) } } },
        { returnDocument: 'after' },
      );
      if (!updated) {
        // Full by now (or gone): report it from the latest state.
        const latest = await this.find(hotelId);
        this.uploads.assertCanAdd('hotel', latest.photos.length, stored.length);
        throw new ConflictException('The hotel photos changed, try again');
      }
      return toHotelView(updated, await this.ratings.forHotel(hotelId));
    } catch (error) {
      await this.discard(urls, user.id);
      throw error;
    }
  }

  async remove(
    user: Caller,
    hotelId: string,
    photoId: string,
  ): Promise<HotelView> {
    assertOwnHotel(user, hotelId);
    const hotel = await this.find(hotelId);
    const photo = hotel.photos.find((p) => p._id.toString() === photoId);
    if (!photo) throw new NotFoundException('Photo not found');

    const updated = await this.hotels.findOneAndUpdate(
      { _id: hotelId, 'photos._id': photo._id },
      { $pull: { photos: { _id: photo._id } } },
      { returnDocument: 'after' },
    );
    // A parallel request removed it first: nothing left to delete.
    if (!updated) throw new NotFoundException('Photo not found');
    await this.discard([photo.url], user.id);
    return toHotelView(updated, await this.ratings.forHotel(hotelId));
  }

  private async find(hotelId: string) {
    const hotel = Types.ObjectId.isValid(hotelId)
      ? await this.hotels.findById(hotelId)
      : null;
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  /**
   * Deletes the files of photos that are gone. Best effort: the database is
   * already right, so a file that cannot be deleted is logged, never reported.
   */
  private async discard(urls: string[], ownerId: string): Promise<void> {
    const results = await Promise.allSettled(
      urls.map((url) => this.uploads.remove(url, ownerId)),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.error(
        `Could not delete ${failed} of ${urls.length} hotel photo files`,
      );
    }
  }
}
