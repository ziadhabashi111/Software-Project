import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import type { ItineraryBookingsService } from './itinerary-bookings.service';
import type { BudgetSummaryService } from './budget/budget-summary.service';
import { ItineraryPdfService } from './itinerary-pdf.service';
import type { ItinerariesService } from './itineraries.service';
import type { PublicItinerariesService } from './public-itineraries.service';

const OWNER: AuthUser = { id: 'u1', role: Role.USER };
const OTHER: AuthUser = { id: 'u2', role: Role.USER };
const MODERATOR: AuthUser = { id: 'm1', role: Role.HOTEL_MODERATOR };
const ID = '6660a1b2c3d4e5f601234567';
const NOW = new Date('2026-11-20T10:00:00.000Z');

const ownerView = {
  id: ID,
  title: 'Private plan',
  countries: ['EG'],
  startDate: '2027-03-10',
  days: [
    { id: 'd1', number: 1, date: '2027-03-10', city: 'cairo', activities: [] },
  ],
};
const publicView = {
  ...ownerView,
  title: 'Public plan',
  author: { id: 'u1', name: 'Sara' },
  budget: null,
};
const ownerBudget = {
  currency: 'USD',
  rateDate: null,
  ratesStale: false,
  totals: {
    food: 10,
    accommodation: 50,
    in_city_transport: 5,
    activities: 15,
    intercity_transport: 20,
    total: 100,
  },
  byDay: [],
};
const booking = {
  id: 'l1',
  bookingType: 'flight',
  bookingId: 'b1',
  dayId: 'd1',
  dayNumber: 1,
  reference: 'FB-ABC123',
  title: 'CAI → JFK · EG123',
  status: 'CONFIRMED',
  startDate: '2027-03-10',
  endDate: '2027-03-10',
  amount: 840,
  currency: 'USD',
  counted: true,
};

function build() {
  const itineraries = { get: jest.fn().mockResolvedValue(ownerView) };
  const budgets = { summary: jest.fn().mockResolvedValue(ownerBudget) };
  const bookings = { list: jest.fn().mockResolvedValue([booking]) };
  const publicItineraries = { get: jest.fn().mockResolvedValue(publicView) };
  const service = new ItineraryPdfService(
    itineraries as unknown as ItinerariesService,
    budgets as unknown as BudgetSummaryService,
    bookings as unknown as ItineraryBookingsService,
    publicItineraries as unknown as PublicItinerariesService,
  );
  return { service, itineraries, budgets, bookings, publicItineraries };
}

describe('ItineraryPdfService (ITN-28)', () => {
  it('gives the owner everything: bookings and the owner budget', async () => {
    const { service, budgets, bookings, publicItineraries } = build();
    const model = await service.model(OWNER, ID, 'EUR', NOW);
    expect(model.title).toBe('Private plan');
    expect(model.bookings).toEqual([booking]);
    expect(model.budget).toEqual(ownerBudget);
    expect(model.generatedOn).toBe('2026-11-20');
    expect(budgets.summary).toHaveBeenCalledWith(OWNER, ID, 'EUR');
    expect(bookings.list).toHaveBeenCalledWith(OWNER, ID);
    expect(publicItineraries.get).not.toHaveBeenCalled();
  });

  it('still produces the owner PDF when exchange rates are unavailable', async () => {
    const { service, budgets } = build();
    budgets.summary.mockRejectedValue(new Error('rates down'));
    const model = await service.model(OWNER, ID, undefined, NOW);
    expect(model.budget).toBeNull();
    expect(model.bookings).toEqual([booking]);
  });

  it('rejects an unsupported currency instead of hiding it', async () => {
    const { service, budgets } = build();
    budgets.summary.mockRejectedValue(new BadRequestException('currency'));
    await expect(service.model(OWNER, ID, 'XXX', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Someone else's PDF of a public itinerary is the public copy: the author's
  // name, the public budget, and never the owner's bookings.
  it('gives another user only the public copy of a public itinerary', async () => {
    const { service, itineraries, budgets, bookings, publicItineraries } =
      build();
    itineraries.get.mockRejectedValue(new NotFoundException());
    const model = await service.model(OTHER, ID, undefined, NOW);
    expect(model.title).toBe('Public plan');
    expect(model.author).toBe('Sara');
    expect(model.bookings).toBeUndefined();
    expect(bookings.list).not.toHaveBeenCalled();
    expect(budgets.summary).not.toHaveBeenCalled();
    expect(publicItineraries.get).toHaveBeenCalledWith(ID, undefined);
  });

  it('gives a guest only the public copy and never looks for an owner', async () => {
    const { service, itineraries, publicItineraries } = build();
    const model = await service.model(undefined, ID, 'EUR', NOW);
    expect(model.author).toBe('Sara');
    expect(itineraries.get).not.toHaveBeenCalled();
    expect(publicItineraries.get).toHaveBeenCalledWith(ID, 'EUR');
  });

  it('gives staff accounts only the public copy', async () => {
    const { service, itineraries } = build();
    const model = await service.model(MODERATOR, ID, undefined, NOW);
    expect(model.bookings).toBeUndefined();
    expect(itineraries.get).not.toHaveBeenCalled();
  });

  it('answers 404 when it is neither yours nor public', async () => {
    const { service, itineraries, publicItineraries } = build();
    itineraries.get.mockRejectedValue(new NotFoundException());
    publicItineraries.get.mockRejectedValue(new NotFoundException());
    await expect(
      service.model(OTHER, ID, undefined, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not hide other failures behind the public copy', async () => {
    const { service, itineraries, publicItineraries } = build();
    itineraries.get.mockRejectedValue(new Error('database down'));
    await expect(service.model(OWNER, ID, undefined, NOW)).rejects.toThrow(
      'database down',
    );
    expect(publicItineraries.get).not.toHaveBeenCalled();
  });

  it('renders the model into a PDF with a safe file name', async () => {
    const { service } = build();
    const { filename, pdf } = await service.pdf(OWNER, ID, undefined, NOW);
    expect(filename).toBe('itinerary-private-plan.pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
