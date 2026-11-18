import { NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { ProviderDirectory, ProviderType } from '../admin/provider-directory';
import { Role } from '../auth/auth.types';
import { AirlinesService } from './airlines.service';
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
  const service = new AirlinesService(
    model as unknown as Model<Airline>,
    directory,
  );
  return { service, directory, model };
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
});
