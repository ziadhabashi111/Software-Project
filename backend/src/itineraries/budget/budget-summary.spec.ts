import { BudgetCategory } from './budget-categories';
import { PLATFORM_CURRENCY } from '../../payments/platform-currency';
import {
  activityCurrency,
  foreignCurrencies,
  summarize,
} from './budget-summary';
import type { SummaryInput } from './budget-summary';

const days = [
  {
    id: 'd1',
    number: 1,
    date: '2027-03-01',
    city: 'cairo',
    activities: [{ cost: 20, currency: 'USD' }, { cost: 10 }, {}],
  },
  { id: 'd2', number: 2, date: '2027-03-02', city: 'luxor', activities: [] },
];

const input: SummaryInput = {
  days,
  entries: [
    { dayId: 'd1', category: BudgetCategory.FOOD, amount: 30, currency: 'USD' },
    { dayId: 'd1', category: BudgetCategory.FOOD, amount: 90, currency: 'EUR' },
    {
      dayId: 'd2',
      category: BudgetCategory.ACCOMMODATION,
      amount: 100,
      currency: 'USD',
    },
    {
      dayId: 'gone',
      category: BudgetCategory.FOOD,
      amount: 999,
      currency: 'USD',
    },
  ],
  transportCosts: [{ dayId: 'd2', amount: 45, currency: 'EGP' }],
};

// EUR is worth 1/0.9 USD, EGP is 1/50 USD.
const toUsd = (amount: number, from: string): number =>
  from === 'USD' ? amount : from === 'EUR' ? amount / 0.9 : amount / 50;

describe('budget summary (ITN-14)', () => {
  const result = summarize(input, toUsd);

  it('adds entries, activity costs under Activities and intercity transport', () => {
    expect(result.byDay[0]).toMatchObject({
      food: 130, // 30 + 90 EUR (= 100 USD)
      activities: 30, // 20 USD + 10 legacy cost without a currency (USD)
      total: 160,
    });
    expect(result.byDay[1]).toMatchObject({
      accommodation: 100,
      intercity_transport: 0.9, // 45 EGP
      total: 100.9,
    });
  });

  it('breaks the total down by category and by day', () => {
    expect(result.totals).toEqual({
      food: 130,
      accommodation: 100,
      in_city_transport: 0,
      activities: 30,
      intercity_transport: 0.9,
      total: 260.9,
    });
    expect(result.byDay.reduce((sum, day) => sum + day.total, 0)).toBeCloseTo(
      result.totals.total,
    );
  });

  it('ignores entries of a day that no longer exists', () => {
    expect(result.totals.food).toBe(130);
  });

  it('keeps day numbers, dates and cities for the by-day view', () => {
    expect(result.byDay.map((d) => [d.number, d.date, d.city])).toEqual([
      [1, '2027-03-01', 'cairo'],
      [2, '2027-03-02', 'luxor'],
    ]);
  });

  it('converts a legacy activity cost with no currency from the platform currency, not the display currency', () => {
    // 1 USD = 50 EGP: shown in EGP, the legacy 10 must become 500, not stay 10.
    const usdToEgp = (amount: number, from: string): number =>
      from === 'EGP' ? amount : from === 'USD' ? amount * 50 : NaN;
    const legacy: SummaryInput = {
      days: [{ ...days[0], activities: [{ cost: 10 }, { cost: 0 }] }],
      entries: [],
      transportCosts: [],
    };
    expect(summarize(legacy, usdToEgp).totals.activities).toBe(500);
    expect([...foreignCurrencies(legacy, 'EGP')]).toEqual(['USD']);
    expect(activityCurrency({})).toBe(PLATFORM_CURRENCY);
    expect(activityCurrency({ currency: 'EUR' })).toBe('EUR');
  });

  it('is all zeros for an itinerary with no budget', () => {
    const bare = days.map((day) => ({ ...day, activities: [] }));
    const empty = summarize(
      { days: bare, entries: [], transportCosts: [] },
      toUsd,
    );
    expect(empty.totals.total).toBe(0);
  });
});

describe('which currencies need rates (ITN-18)', () => {
  it('lists the currencies other than the target', () => {
    expect([...foreignCurrencies(input, 'USD')].sort()).toEqual(['EGP', 'EUR']);
  });

  it('needs no rates when everything is already in the target currency', () => {
    const same: SummaryInput = {
      days: [{ ...days[0], activities: [{ cost: 5 }] }],
      entries: [
        {
          dayId: 'd1',
          category: BudgetCategory.FOOD,
          amount: 1,
          currency: 'USD',
        },
      ],
      transportCosts: [],
    };
    expect(foreignCurrencies(same, 'USD').size).toBe(0);
  });
});
