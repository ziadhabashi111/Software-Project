import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { HotelRatings } from '../hotel-bookings/hotel-ratings';
import type { UploadsService } from '../uploads/uploads.service';
import { HotelPhotosService } from './hotel-photos.service';
import type { Hotel } from './schemas/hotel.schema';

const HOTEL_ID = new Types.ObjectId().toString();
const moderator = {
  id: 'm1',
  role: Role.HOTEL_MODERATOR,
  providerId: HOTEL_ID,
};
const otherModerator = {
  id: 'm2',
  role: Role.HOTEL_MODERATOR,
  providerId: new Types.ObjectId().toString(),
};
const file = {
  buffer: Buffer.from([0xff, 0xd8, 0xff]),
  size: 3,
  mimetype: 'image/jpeg',
  originalname: 'a.jpg',
};

function photo(url: string) {
  return { _id: new Types.ObjectId(), url };
}

function hotelDoc(photos: { _id: Types.ObjectId; url: string }[] = []) {
  return {
    id: HOTEL_ID,
    name: 'Nile View',
    address: '12 Corniche',
    city: 'cairo',
    country: 'EG',
    starClass: 4,
    amenities: [],
    photos,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    isActive: true,
    cancellationTiers: [],
  };
}

function build(current: ReturnType<typeof hotelDoc> | null = hotelDoc()) {
  const hotels = {
    findById: jest.fn().mockResolvedValue(current),
    findOneAndUpdate: jest.fn().mockImplementation(() =>
      Promise.resolve(
        current && {
          ...current,
          photos: [...current.photos, photo('/uploads/new.jpg')],
        },
      ),
    ),
  };
  const uploads = {
    saveImages: jest
      .fn()
      .mockImplementation((files: unknown[]) =>
        Promise.resolve(
          files.map((_, i) => ({ id: `n${i}.jpg`, url: `/uploads/n${i}.jpg` })),
        ),
      ),
    assertCanAdd: jest.fn(),
    removeForItem: jest.fn().mockResolvedValue(true),
  };
  const ratings = {
    forHotel: jest
      .fn()
      .mockResolvedValue({ averageRating: null, ratingCount: 0 }),
  };
  const service = new HotelPhotosService(
    hotels as unknown as Model<Hotel>,
    uploads as unknown as UploadsService,
    ratings as unknown as HotelRatings,
  );
  return { service, hotels, uploads };
}

describe('HotelPhotosService.add (HTL-01, GEN-08)', () => {
  it('stores the files as the moderator and attaches them to the hotel', async () => {
    const { service, hotels, uploads } = build(hotelDoc([photo('/uploads/a')]));
    const view = await service.add(moderator, HOTEL_ID, [file, file]);

    expect(uploads.saveImages).toHaveBeenCalledWith(
      [file, file],
      'hotel',
      'm1',
      1,
    );
    const [filter, update] = hotels.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $push: { photos: { $each: { url: string }[] } } },
    ];
    expect(update.$push.photos.$each.map((p) => p.url)).toEqual([
      '/uploads/n0.jpg',
      '/uploads/n1.jpg',
    ]);
    // The limit is part of the write itself, so two parallel uploads cannot both fit.
    expect(filter).toHaveProperty(['photos.3', '$exists'], false);
    expect(view.photos.length).toBe(2);
  });

  it('writes nothing for someone else’s hotel, even an admin', async () => {
    const { service, uploads } = build();
    await expect(
      service.add(otherModerator, HOTEL_ID, [file]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.add({ id: 'a1', role: Role.ADMIN }, HOTEL_ID, [file]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(uploads.saveImages).not.toHaveBeenCalled();
  });

  it('answers 404 for a hotel that does not exist', async () => {
    const { service, uploads } = build(null);
    await expect(
      service.add(moderator, HOTEL_ID, [file]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.saveImages).not.toHaveBeenCalled();
  });

  it('deletes the stored files and reports the limit when a parallel upload filled the hotel first', async () => {
    const { service, hotels, uploads } = build(hotelDoc());
    hotels.findOneAndUpdate.mockResolvedValue(null);
    hotels.findById
      .mockResolvedValueOnce(hotelDoc())
      .mockResolvedValueOnce(
        hotelDoc([1, 2, 3, 4, 5].map((n) => photo(`/uploads/${n}`))),
      );
    uploads.assertCanAdd.mockImplementation(() => {
      throw new BadRequestException('At most 5 images are allowed');
    });

    await expect(
      service.add(moderator, HOTEL_ID, [file]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploads.removeForItem).toHaveBeenCalledWith('/uploads/n0.jpg');
  });

  it('deletes the stored files if the database write fails', async () => {
    const { service, hotels, uploads } = build();
    hotels.findOneAndUpdate.mockRejectedValue(new Error('db down'));
    await expect(service.add(moderator, HOTEL_ID, [file])).rejects.toThrow(
      'db down',
    );
    expect(uploads.removeForItem).toHaveBeenCalledWith('/uploads/n0.jpg');
  });
});

describe('HotelPhotosService.remove (HTL-01, GEN-08)', () => {
  it('removes the photo from the hotel and deletes its file', async () => {
    const keep = photo('/uploads/keep.jpg');
    const gone = photo('/uploads/gone.jpg');
    const { service, hotels, uploads } = build(hotelDoc([keep, gone]));
    hotels.findOneAndUpdate.mockResolvedValue(hotelDoc([keep]));

    const view = await service.remove(moderator, HOTEL_ID, gone._id.toString());

    const [filter, update] = hotels.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $pull: { photos: { _id: Types.ObjectId } } },
    ];
    expect(filter).toHaveProperty(['photos._id']);
    expect(update.$pull.photos._id.toString()).toBe(gone._id.toString());
    expect(uploads.removeForItem).toHaveBeenCalledWith('/uploads/gone.jpg');
    expect(view.photos.map((p) => p.url)).toEqual(['/uploads/keep.jpg']);
  });

  it('answers 404 for a photo the hotel does not have, and deletes nothing', async () => {
    const { service, uploads } = build(hotelDoc([photo('/uploads/a.jpg')]));
    await expect(
      service.remove(moderator, HOTEL_ID, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(uploads.removeForItem).not.toHaveBeenCalled();
  });

  it('is only for the hotel’s own moderator', async () => {
    const { service, uploads } = build(hotelDoc([photo('/uploads/a.jpg')]));
    await expect(
      service.remove(otherModerator, HOTEL_ID, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(uploads.removeForItem).not.toHaveBeenCalled();
  });

  it('does not fail the request if the file cannot be deleted', async () => {
    const gone = photo('/uploads/gone.jpg');
    const { service, hotels, uploads } = build(hotelDoc([gone]));
    hotels.findOneAndUpdate.mockResolvedValue(hotelDoc());
    uploads.removeForItem.mockRejectedValue(new Error('disk'));
    await expect(
      service.remove(moderator, HOTEL_ID, gone._id.toString()),
    ).resolves.toMatchObject({ photos: [] });
  });
});
