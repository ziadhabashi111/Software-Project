import { Logger, NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { ProviderDirectory, ProviderType } from '../admin/provider-directory';
import { Role } from '../auth/auth.types';
import { AirlinesService } from './airlines.service';
import { FlightBookingHooks } from './flight-booking-hooks';
import type { FlightBookingLink } from './flight-booking-hooks';
import type { Airline } from './schemas/airline.schema';

interface FakeAirline {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  cancellationPolicy: never[];
  save: jest.Mock;
}

function build(airline: FakeAirline | null, createError?: Error) {
  const model = {
    findById: jest.fn().mockResolvedValue(airline),
    exists: jest.fn().mockResolvedValue(airline ? { _id: airline.id } : null),
    create: jest.fn().mockImplementation(() => {
      if (createError) throw createError;
      return Promise.resolve(airline);
    }),
  };
  const directory = new ProviderDirectory();
  const hooks = new FlightBookingHooks();
  const service = new AirlinesService(
    model as unknown as Model<Airline>,
    directory,
    hooks,
  );
  return { service, directory, model, hooks };
}

const airline = (overrides: Partial<FakeAirline> = {}): FakeAirline => ({
  id: 'a1',
  name: 'EgyptAir',
  code: 'MS',
  isActive: true,
  cancellationPolicy: [],
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('AirlinesService', () => {
  it('registers itself with the admin provider directory (ACC-13, ACC-15)', () => {
    const { service, directory } = build(airline());
    service.onModuleInit();
    expect(directory.get(ProviderType.AIRLINE)).toBe(service);
  });

  it('deactivates and reactivates, reporting whether anything changed (ACC-15)', async () => {
    const doc = airline();
    const { service } = build(doc);
    expect(await service.setActive('a1', false)).toMatchObject({
      name: 'EgyptAir',
      changed: true,
    });
    expect(doc.isActive).toBe(false);
    expect(doc.save).toHaveBeenCalledTimes(1);

    expect(await service.setActive('a1', false)).toMatchObject({
      changed: false,
    });
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('answers null for an unknown airline', async () => {
    const { service } = build(null);
    expect(await service.setActive('nope', true)).toBeNull();
    expect(await service.exists('nope')).toBe(false);
  });

  it('hides a deactivated airline from guests and users but not admins or its moderator', async () => {
    const hidden = airline({ isActive: false });
    const { service } = build(hidden);
    await expect(service.get('a1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.get('a1', { id: 'u1', role: Role.USER }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.get('a1', {
        id: 'm2',
        role: Role.AIRLINE_MODERATOR,
        providerId: 'a2',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.get('a1', { id: 'ad', role: Role.ADMIN }),
    ).resolves.toMatchObject({ id: 'a1', isActive: false });
    await expect(
      service.get('a1', {
        id: 'm1',
        role: Role.AIRLINE_MODERATOR,
        providerId: 'a1',
      }),
    ).resolves.toMatchObject({ id: 'a1' });
  });

  it('turns a duplicate airline code into a 409 on the code field', async () => {
    const { service } = build(
      null,
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    );
    await expect(
      service.create({ name: 'Other', code: 'MS' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  describe('affected travellers on deactivation (ACC-15)', () => {
    const linkWith = (
      ids: Promise<string[]>,
    ): { link: FlightBookingLink; ask: jest.Mock } => {
      const ask = jest.fn().mockReturnValue(ids);
      return {
        ask,
        link: {
          getConfirmedPassengerUserIds: jest.fn(),
          cancelBookingsForFlight: jest.fn(),
          listBookings: jest.fn(),
          getConfirmedUserIdsForAirline: ask,
        },
      };
    };

    it('returns the users with an upcoming Confirmed booking when the airline becomes inactive', async () => {
      const { service, hooks } = build(airline());
      const { link, ask } = linkWith(Promise.resolve(['u1', 'u2']));
      hooks.register(link);
      const change = await service.setActive('a1', false);
      expect(ask).toHaveBeenCalledWith('a1');
      expect(change?.affectedUserIds).toEqual(['u1', 'u2']);
    });

    it('does not ask when nothing changes or when the airline is reactivated', async () => {
      const { service, hooks } = build(airline({ isActive: false }));
      const { link, ask } = linkWith(Promise.resolve(['u1']));
      hooks.register(link);
      expect((await service.setActive('a1', false))?.affectedUserIds).toEqual(
        [],
      );
      expect((await service.setActive('a1', true))?.affectedUserIds).toEqual(
        [],
      );
      expect(ask).not.toHaveBeenCalled();
    });

    it('is empty when no booking module is connected or it lacks the method', async () => {
      const none = build(airline());
      expect(
        (await none.service.setActive('a1', false))?.affectedUserIds,
      ).toEqual([]);

      const old = build(airline());
      old.hooks.register({
        getConfirmedPassengerUserIds: jest.fn(),
        cancelBookingsForFlight: jest.fn(),
        listBookings: jest.fn(),
      });
      expect(
        (await old.service.setActive('a1', false))?.affectedUserIds,
      ).toEqual([]);
    });

    it('still deactivates when the lookup fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const doc = airline();
      const { service, hooks } = build(doc);
      hooks.register(linkWith(Promise.reject(new Error('boom'))).link);
      const change = await service.setActive('a1', false);
      expect(doc.isActive).toBe(false);
      expect(change).toMatchObject({ changed: true, affectedUserIds: [] });
      jest.restoreAllMocks();
    });
  });
});
