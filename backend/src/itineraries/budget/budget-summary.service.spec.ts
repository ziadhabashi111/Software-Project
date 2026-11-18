import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import type { CurrencyCatalog } from '../../users/currency-catalog';
import type { UsersService } from '../../users/users.service';
import type { ItineraryRepository } from '../itinerary.repository';
import { BudgetSummaryService } from './budget-summary.service';
import type { FxService } from './fx/fx.service';
import type { BudgetEntry } from './schemas/budget-entry.schema';
import type { TransportCost } from './schemas/transport-cost.schema';

const owner: AuthUser = {
  id: new Types.ObjectId().toString(),
  role: Role.USER,
};

function build(catalog?: CurrencyCatalog) {
  const itinerary = {
    _id: new Types.ObjectId(),
    startDate: new Date('2027-03-01T00:00:00.000Z'),
    days: [
      {
        _id: new Types.ObjectId(),
        city: 'cairo',
        // A legacy cost with no currency counts as the platform currency.
        activities: [{ cost: 10 }],
      },
    ],
  };
  const entries = { find: jest.fn().mockResolvedValue([]) };
  const transport = { find: jest.fn().mockResolvedValue([]) };
  const repository = { loadOwned: jest.fn().mockResolvedValue(itinerary) };
  const fx = {
    getRates: jest.fn().mockResolvedValue({
      base: 'USD',
      rates: { EUR: 0.5 },
      rateDate: '2026-11-18',
      stale: false,
    }),
  };
  const users = {
    findById: jest.fn().mockResolvedValue({ preferredCurrency: 'USD' }),
  };
  const service = new BudgetSummaryService(
    entries as unknown as Model<BudgetEntry>,
    transport as unknown as Model<TransportCost>,
    repository as unknown as ItineraryRepository,
    fx as unknown as FxService,
    users as unknown as UsersService,
    catalog,
  );
  return { service, fx };
}

const catalog = (supported: string[]): CurrencyCatalog => ({
  isSupported: (code: string) => Promise.resolve(supported.includes(code)),
});

describe('BudgetSummaryService (ITN-14, ITN-18)', () => {
  it('answers 400 for an unsupported ?currency= when the currency list is loaded', async () => {
    const { service, fx } = build(catalog(['USD', 'EUR']));
    const call = service.summary(owner, 'it1', 'ZZZ');
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.summary(owner, 'it1', 'ZZZ')).rejects.toMatchObject({
      response: {
        errors: [
          { field: 'currency', messages: ['ZZZ is not a supported currency'] },
        ],
      },
    });
    expect(fx.getRates).not.toHaveBeenCalled();
  });

  it('converts into a supported ?currency=, including legacy activity costs from USD', async () => {
    const { service } = build(catalog(['USD', 'EUR']));
    const view = await service.summary(owner, 'it1', 'EUR');
    expect(view).toMatchObject({ currency: 'EUR', rateDate: '2026-11-18' });
    expect(view.totals.activities).toBe(5); // 10 USD at 0.5 EUR per USD
  });

  it('only checks the format when no currency list is available', async () => {
    const { service, fx } = build();
    fx.getRates.mockResolvedValue({
      base: 'USD',
      rates: { ZZZ: 2 },
      rateDate: '2026-11-18',
      stale: false,
    });
    await expect(service.summary(owner, 'it1', 'ZZZ')).resolves.toMatchObject({
      currency: 'ZZZ',
    });
  });
});
