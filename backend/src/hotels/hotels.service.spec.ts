import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../auth/auth.types';
import type { HotelRatings } from '../hotel-bookings/hotel-ratings';
import { PlaceCatalog } from '../itineraries/places';
import { HotelsService } from './hotels.service';
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
const admin = { id: 'a1', role: Role.ADMIN };
const traveller = { id: 'u1', role: Role.USER };

function hotelDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: HOTEL_ID,
    name: 'Nile View',
    address: '12 Corniche',
    city: 'cairo',
    country: 'EG',
    starClass: 4,
    amenities: ['wifi'],
    photos: [],
    checkInTime: '14:00',
    checkOutTime: '12:00',
    isActive: true,
    cancellationTiers: [],
    ...overrides,
  };
}

function build(
  options: {
    found?: ReturnType<typeof hotelDoc> | null;
    knownCities?: string[];
    knownCountries?: string[];
  } = {},
) {
  const found = options.found === undefined ? hotelDoc() : options.found;
  const hotels = {
    create: jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) =>
        Promise.resolve(hotelDoc(data)),
      ),
    findById: jest.fn().mockResolvedValue(found),
    findByIdAndUpdate: jest
      .fn()
      .mockImplementation(
        (_id: string, update: { $set: Record<string, unknown> }) =>
          Promise.resolve(found ? { ...found, ...update.$set } : null),
      ),
  };
  const ratings = {
    forHotel: jest
      .fn()
      .mockResolvedValue({ averageRating: 4.5, ratingCount: 2 }),
  };
  const places = new PlaceCatalog();
  if (options.knownCities || options.knownCountries) {
    places.register({
      isCity: (id) => Promise.resolve((options.knownCities ?? []).includes(id)),
      isCountry: (code) =>
        Promise.resolve((options.knownCountries ?? []).includes(code)),
    });
  }
  const service = new HotelsService(
    hotels as unknown as Model<Hotel>,
    places,
    ratings as unknown as HotelRatings,
  );
  return { service, hotels };
}

const createDto = {
  name: 'Nile View',
  address: '12 Corniche',
  city: 'cairo',
  country: 'EG',
  starClass: 4,
};

describe('HotelsService.create (HTL-01)', () => {
  it('creates a hotel and returns it with its rating summary', async () => {
    const { service, hotels } = build();
    const view = await service.create({ ...createDto, amenities: ['wifi'] });
    expect(hotels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nile View',
        city: 'cairo',
        country: 'EG',
      }),
    );
    expect(view).toMatchObject({
      name: 'Nile View',
      rating: { averageRating: 4.5, ratingCount: 2 },
    });
  });

  it('rejects a city or country that is not in the predefined lists', async () => {
    const { service, hotels } = build({
      knownCities: ['cairo'],
      knownCountries: ['EG'],
    });
    await expect(
      service.create({ ...createDto, city: 'atlantis' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ ...createDto, country: 'ZZ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(hotels.create).not.toHaveBeenCalled();
  });
});

describe('HotelsService.update (HTL-01: a moderator edits only their own hotel)', () => {
  it('changes only the fields that were sent', async () => {
    const { service, hotels } = build();
    const view = await service.update(moderator, HOTEL_ID, {
      description: 'Riverside',
      starClass: 5,
    });
    expect(hotels.findByIdAndUpdate).toHaveBeenCalledWith(
      HOTEL_ID,
      { $set: { description: 'Riverside', starClass: 5 } },
      expect.anything(),
    );
    expect(view.starClass).toBe(5);
  });

  it('refuses everyone else before touching the database', async () => {
    const { service, hotels } = build();
    for (const user of [otherModerator, admin, traveller]) {
      await expect(
        service.update(user, HOTEL_ID, { starClass: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(hotels.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('needs at least one field, and checks a new city against the list', async () => {
    const { service } = build({ knownCities: ['cairo'] });
    await expect(
      service.update(moderator, HOTEL_ID, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(moderator, HOTEL_ID, { city: 'atlantis' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 404 when the moderator’s hotel no longer exists', async () => {
    const { service } = build({ found: null });
    await expect(
      service.update(moderator, HOTEL_ID, { starClass: 3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('HotelsService.get (HTL-02, ACC-15)', () => {
  it('shows an active hotel to everyone, guests included', async () => {
    const { service } = build();
    expect((await service.get(HOTEL_ID)).name).toBe('Nile View');
    expect((await service.get(HOTEL_ID, traveller)).id).toBe(HOTEL_ID);
  });

  it('hides a deactivated hotel from the public, but not from admins or its own moderator', async () => {
    const { service } = build({ found: hotelDoc({ isActive: false }) });
    await expect(service.get(HOTEL_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.get(HOTEL_ID, traveller)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.get(HOTEL_ID, otherModerator)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await service.get(HOTEL_ID, admin)).isActive).toBe(false);
    expect((await service.get(HOTEL_ID, moderator)).isActive).toBe(false);
  });

  it('answers 404 for an unknown or malformed id', async () => {
    await expect(
      build({ found: null }).service.get(HOTEL_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    const { service, hotels } = build();
    await expect(service.get('not-an-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(hotels.findById).not.toHaveBeenCalled();
  });
});

describe('HotelsService.setPolicies (HTL-09, HTL-10)', () => {
  it('stores the times and the tiers, longest notice first, with the shared FLT-09 rule', async () => {
    const { service, hotels } = build();
    await service.setPolicies(moderator, HOTEL_ID, {
      checkInTime: '15:00',
      checkOutTime: '11:00',
      tiers: [
        { daysBefore: 3, refundPercent: 50 },
        { daysBefore: 14, refundPercent: 100 },
      ],
    });
    expect(hotels.findByIdAndUpdate).toHaveBeenCalledWith(
      HOTEL_ID,
      {
        $set: {
          checkInTime: '15:00',
          checkOutTime: '11:00',
          cancellationTiers: [
            { daysBefore: 14, refundPercent: 100 },
            { daysBefore: 3, refundPercent: 50 },
          ],
        },
      },
      expect.anything(),
    );
  });

  it('rejects two tiers with the same threshold, and needs something to set', async () => {
    const { service } = build();
    await expect(
      service.setPolicies(moderator, HOTEL_ID, {
        tiers: [
          { daysBefore: 7, refundPercent: 100 },
          { daysBefore: 7, refundPercent: 50 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setPolicies(moderator, HOTEL_ID, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is for the hotel’s own moderator only', async () => {
    const { service, hotels } = build();
    await expect(
      service.setPolicies(otherModerator, HOTEL_ID, { checkInTime: '15:00' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(hotels.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('an empty tier list clears the policy (no refund)', async () => {
    const { service, hotels } = build();
    await service.setPolicies(moderator, HOTEL_ID, { tiers: [] });
    expect(hotels.findByIdAndUpdate).toHaveBeenCalledWith(
      HOTEL_ID,
      { $set: { cancellationTiers: [] } },
      expect.anything(),
    );
  });
});
