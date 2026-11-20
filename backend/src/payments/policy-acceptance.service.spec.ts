import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingPaymentGateway } from './booking-payment-gateway';
import { PolicyAcceptanceService } from './policy-acceptance.service';

const USER = new Types.ObjectId().toString();
const BOOKING = new Types.ObjectId().toString();

function setup() {
  const acceptances = {
    findOneAndUpdate: jest
      .fn()
      .mockResolvedValue({ acceptedAt: new Date('2026-11-18') }),
    findOne: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(null),
  };
  const gateway = {
    payable: jest.fn().mockResolvedValue({}),
    acceptanceTarget: jest.fn((type: string, bookingId: string) =>
      Promise.resolve({ type, bookingId }),
    ),
    policies: jest
      .fn()
      .mockResolvedValue({ bookingType: 'flight', cancellationTiers: [] }),
  };
  const service = new PolicyAcceptanceService(
    acceptances as never,
    gateway as unknown as BookingPaymentGateway,
  );
  return { service, acceptances, gateway };
}

describe('PolicyAcceptanceService (PAY-02)', () => {
  it('stores the acceptance with a timestamp for the owner', async () => {
    const { service, gateway } = setup();
    const result = await service.accept('flight', BOOKING, USER);
    expect(gateway.payable).toHaveBeenCalledWith('flight', BOOKING, USER);
    expect(result.acceptedAt).toEqual(new Date('2026-11-18'));
  });

  it('blocks payment until accepted', async () => {
    const { service } = setup();
    await expect(
      service.assertAccepted('flight', BOOKING, USER),
    ).rejects.toThrow(ConflictException);
  });

  it('lets payment through once accepted', async () => {
    const { service, acceptances } = setup();
    acceptances.exists.mockResolvedValue({ _id: 1 });
    await expect(
      service.assertAccepted('flight', BOOKING, USER),
    ).resolves.toBeUndefined();
  });

  it('shows the policies and the acceptance state', async () => {
    const { service, acceptances } = setup();
    expect((await service.view('flight', BOOKING, USER)).accepted).toBe(false);
    acceptances.findOne.mockResolvedValue({
      acceptedAt: new Date('2026-11-18'),
    });
    expect((await service.view('flight', BOOKING, USER)).accepted).toBe(true);
  });
});
