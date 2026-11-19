import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../auth/auth.types';
import { HotelSearchHook } from './hotel-search';
import type { HotelSearchPort } from './hotel-search';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import type { ItineraryRepository } from './itinerary.repository';
import { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto';

const me = { id: 'u1', role: Role.USER };

const itinerary = {
  id: 'i1',
  startDate: new Date('2027-03-01T00:00:00Z'),
  days: [
    { _id: new Types.ObjectId(), city: 'cairo' },
    { _id: new Types.ObjectId(), city: 'cairo' },
    { _id: new Types.ObjectId(), city: 'luxor' },
  ],
};

const query = (overrides: Partial<ItineraryHotelsQueryDto> = {}) =>
  Object.assign(
    new ItineraryHotelsQueryDto(),
    { page: 1, limit: 10, group: 1, guests: 2, rooms: 1 },
    overrides,
  );

function build(options: { port?: HotelSearchPort; ownerOk?: boolean } = {}) {
  const repository = {
    loadOwned: jest
      .fn()
      .mockImplementation(() =>
        options.ownerOk === false
          ? Promise.reject(new NotFoundException('Itinerary not found'))
          : Promise.resolve(itinerary),
      ),
  };
  const hook = new HotelSearchHook();
  if (options.port) hook.register(options.port);
  return {
    service: new ItineraryHotelsService(
      repository as unknown as ItineraryRepository,
      hook,
    ),
    repository,
  };
}

describe('ItineraryHotelsService (ITN-25)', () => {
  it('searches the hotels of the chosen city group for its dates, reusing the hotel search', async () => {
    const search = jest.fn().mockResolvedValue({
      items: [{ name: 'Nile View' }],
      total: 1,
      page: 1,
      limit: 10,
    });
    const { service } = build({ port: { search } });
    const result = await service.search(
      me,
      'i1',
      query({ group: 1, guests: 3, rooms: 2 }),
    );

    expect(search).toHaveBeenCalledWith({
      city: 'cairo',
      checkIn: '2027-03-01',
      checkOut: '2027-03-03',
      guests: 3,
      rooms: 2,
      page: 1,
      limit: 10,
    });
    expect(result.group).toMatchObject({
      number: 1,
      city: 'cairo',
      startDay: 1,
      endDay: 2,
    });
    expect(result.hotels.total).toBe(1);
  });

  it('only the owner may use it: someone else gets the ownership 404', async () => {
    const { service } = build({ ownerOk: false, port: { search: jest.fn() } });
    await expect(service.search(me, 'i1', query())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('answers 400 for a group or party that makes no sense, before touching the search', async () => {
    const search = jest.fn();
    const { service } = build({ port: { search } });
    await expect(
      service.search(me, 'i1', query({ group: 5 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.search(me, 'i1', query({ guests: 1, rooms: 3 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(search).not.toHaveBeenCalled();
  });

  it('answers 503 until the hotels module connects its search', async () => {
    const { service } = build();
    await expect(service.search(me, 'i1', query())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
