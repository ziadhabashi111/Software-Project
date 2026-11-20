import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { Role } from '../../auth/auth.types';
import type { AuthUser } from '../../auth/auth.types';
import type { CurrencyCatalog } from '../../users/currency-catalog';
import type { UsersService } from '../../users/users.service';
import type { ItineraryBookingsService } from '../itinerary-bookings.service';
import type { ItineraryRepository } from '../itinerary.repository';
import { BudgetCategory } from './budget-categories';
import { BudgetSummaryService } from './budget-summary.service';
import type { FxService } from './fx/fx.service';
import type { BudgetEntry } from './schemas/budget-entry.schema';
import type { TransportCost } from './schemas/transport-cost.schema';

const owner: AuthUser = {
  id: new Types.ObjectId().toString(),
  role: Role.USER,
};

/** Budget lines from linked bookings (ITN-27), as the bookings service returns them. */
type LinkedLines = Awaited<ReturnType<ItineraryBookingsService['budgetLines']>>;

function build(
  catalog?: CurrencyCatalog,
  linked?: LinkedLines | ((dayId: string) => LinkedLines),
) {
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
  const repository = {
    loadOwned: jest.fn().mockResolvedValue(itinerary),
    findById: jest.fn().mockResolvedValue(itinerary),
  };
  const bookings = {
    budgetLines: jest
      .fn()
      .mockResolvedValue(
        typeof linked === 'function'
          ? linked(itinerary.days[0]._id.toString())
          : (linked ?? { entries: [], transportCosts: [] }),
      ),
  };
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
    bookings as unknown as ItineraryBookingsService,
    catalog,
  );
  return { service, fx, bookings, itinerary };
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

  describe('linked bookings feed the budget (ITN-27)', () => {
    const lines = (dayId: string): LinkedLines => ({
      entries: [
        {
          dayId,
          category: BudgetCategory.ACCOMMODATION,
          amount: 450,
          currency: 'USD',
        },
      ],
      transportCosts: [{ dayId, amount: 840, currency: 'USD' }],
    });

    it('adds a linked hotel to accommodation and a linked flight to intercity transport', async () => {
      const { service } = build(undefined, lines);
      const view = await service.summary(owner, 'it1', 'USD');
      expect(view.totals.accommodation).toBe(450);
      expect(view.totals.intercity_transport).toBe(840);
      // 10 of legacy activity cost + 450 + 840.
      expect(view.totals.total).toBe(1300);
      expect(view.byDay[0].total).toBe(1300);
    });

    it('converts the linked amounts like every other line', async () => {
      const { service } = build(catalog(['USD', 'EUR']), lines);
      const view = await service.summary(owner, 'it1', 'EUR');
      expect(view.totals.accommodation).toBe(225); // 450 USD at 0.5
      expect(view.totals.intercity_transport).toBe(420);
    });

    it('includes them in the group subtotals the itinerary shows', async () => {
      const { service, itinerary } = build(undefined, lines);
      const { byDay } = await service.dayTotals('it1', owner.id);
      expect(byDay[itinerary.days[0]._id.toString()]).toBe(1300);
    });

    // Bookings are private (references, prices): a visitor of a public
    // itinerary must never see them, not even as part of a total.
    it('keeps them out of the public summary and never reads them there', async () => {
      const { service, bookings } = build(undefined, lines);
      const view = await service.publicSummary('it1', 'USD');
      expect(view.totals.accommodation).toBe(0);
      expect(view.totals.intercity_transport).toBe(0);
      expect(view.totals.total).toBe(10);
      expect(bookings.budgetLines).not.toHaveBeenCalled();
    });
  });
});
