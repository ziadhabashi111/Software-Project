import { BookingStatus } from '../common/booking-status/booking-status';
import { LinkedBookingType } from './booking-links';
import type { BudgetSummaryView } from './budget/budget-summary.service';
import type { LinkedBookingView } from './itinerary-booking-view';
import {
  pdfFilename,
  printable,
  renderItineraryPdf,
  toPdfModel,
} from './itinerary-pdf';
import type { PdfModel } from './itinerary-pdf';
import type { ItineraryView } from './itinerary-view';
import type { PublicItineraryView } from './public-itinerary-view';

const day = (number: number, city: string, activities: object[] = []) => ({
  id: `d${number}`,
  number,
  date: `2027-03-${String(9 + number).padStart(2, '0')}`,
  city,
  activities,
});

const view = {
  id: 'it1',
  title: 'Summer in Egypt',
  countries: ['EG'],
  startDate: '2027-03-10',
  visibility: 'private',
  isHidden: false,
  days: [
    day(1, 'cairo', [
      {
        id: 'a1',
        name: 'Pyramids tour',
        description: 'Early start',
        time: '08:00',
        cost: 45,
        currency: 'USD',
        images: [],
      },
    ]),
    day(2, 'luxor'),
  ],
  groups: [],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as ItineraryView;

const budget = {
  currency: 'USD',
  rateDate: '2026-11-18',
  ratesStale: false,
  totals: {
    food: 10,
    accommodation: 450,
    in_city_transport: 5,
    activities: 45,
    intercity_transport: 840,
    total: 1350,
  },
  byDay: [],
} as unknown as BudgetSummaryView;

const booking: LinkedBookingView = {
  id: 'l1',
  bookingType: LinkedBookingType.FLIGHT,
  bookingId: 'b1',
  dayId: 'd1',
  dayNumber: 1,
  reference: 'FB-ABC123',
  title: 'CAI → JFK · EG123',
  status: BookingStatus.CONFIRMED,
  startDate: '2027-03-10',
  endDate: '2027-03-10',
  amount: 840,
  currency: 'USD',
  counted: true,
};

const GENERATED_ON = '2026-11-20';

/**
 * The text drawn in an uncompressed PDF. pdfkit writes each line as hex
 * strings inside a `[...] TJ` array (split wherever it kerns), so the pieces
 * of every array are decoded and joined back into one line.
 */
const textOf = (pdf: Buffer): string =>
  [...pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map(([, parts]) =>
      [...parts.matchAll(/<([0-9a-fA-F]*)>/g)]
        .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');

const render = async (model: PdfModel) =>
  textOf(await renderItineraryPdf(model, { compress: false }));

describe('pdfFilename (ITN-28)', () => {
  it('makes a safe lower-case name from the title', () => {
    expect(pdfFilename('Summer in Egypt!')).toBe(
      'itinerary-summer-in-egypt.pdf',
    );
    expect(pdfFilename('  A -- B  ')).toBe('itinerary-a-b.pdf');
  });

  // The name goes into a response header: quotes, slashes and line breaks
  // must never get through.
  it('strips anything that could break the header or the path', () => {
    const name = pdfFilename('x"; filename=evil.exe\r\n/../etc/passwd');
    expect(name).toMatch(/^itinerary-[a-z0-9-]+\.pdf$/);
    expect(name).not.toMatch(/["\r\n/\\;]/);
  });

  it('falls back to a plain name when nothing usable is left', () => {
    expect(pdfFilename('مصر 🌍')).toBe('itinerary.pdf');
    expect(pdfFilename('')).toBe('itinerary.pdf');
  });

  it('keeps the name short', () => {
    expect(pdfFilename('a'.repeat(300)).length).toBeLessThanOrEqual(70);
  });
});

describe('printable', () => {
  it('keeps Latin text and accents', () => {
    expect(printable('Café Noël, 12:30')).toBe('Café Noël, 12:30');
  });

  // The built-in PDF fonts only cover Latin-1.
  it('writes arrows as ASCII and unsupported characters as a question mark', () => {
    expect(printable('CAI → JFK')).toBe('CAI -> JFK');
    expect(printable('مصر 🌍')).toBe('??? ??');
  });

  it('drops control characters but keeps line breaks as spaces', () => {
    expect(printable('a\u0000b\u0007c\r\nd')).toBe('abc d');
  });
});

describe('toPdfModel', () => {
  it('builds the owner’s model with budget and linked bookings', () => {
    const model = toPdfModel({
      view,
      budget,
      bookings: [booking],
      generatedOn: GENERATED_ON,
    });
    expect(model).toMatchObject({
      title: 'Summer in Egypt',
      startDate: '2027-03-10',
      endDate: '2027-03-11',
      generatedOn: GENERATED_ON,
    });
    expect(model.author).toBeUndefined();
    expect(model.budget?.totals.total).toBe(1350);
    expect(model.bookings).toHaveLength(1);
    expect(model.days.map((d) => d.city)).toEqual(['cairo', 'luxor']);
  });

  it('names the author of a public itinerary and has no bookings', () => {
    const publicView = {
      ...view,
      author: { id: 'u1', name: 'Sara Ali' },
      budget,
    } as unknown as PublicItineraryView;
    const model = toPdfModel({
      view: publicView,
      budget: publicView.budget,
      generatedOn: GENERATED_ON,
    });
    expect(model.author).toBe('Sara Ali');
    expect(model.bookings).toBeUndefined();
  });

  it('handles an itinerary with no days or budget', () => {
    const model = toPdfModel({
      view: { ...view, days: [] },
      budget: null,
      generatedOn: GENERATED_ON,
    });
    expect(model.days).toEqual([]);
    expect(model.endDate).toBe('2027-03-10');
    expect(model.budget).toBeNull();
  });
});

describe('renderItineraryPdf (ITN-28)', () => {
  const full = () =>
    toPdfModel({
      view,
      budget,
      bookings: [booking],
      generatedOn: GENERATED_ON,
    });

  it('produces a real PDF document', async () => {
    const pdf = await renderItineraryPdf(full());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('prints the title, days, activities, budget and linked bookings', async () => {
    const text = await render(full());
    for (const expected of [
      'Summer in Egypt',
      'Day 1',
      'cairo',
      'Pyramids tour',
      '08:00',
      'Budget',
      '1350',
      'FB-ABC123',
      'CAI -> JFK',
      '2026-11-20',
    ]) {
      expect(text).toContain(expected);
    }
  });

  // A visitor's copy of a public itinerary must carry no bookings or budget
  // that the model does not contain.
  it('prints no bookings section when the model has none', async () => {
    const text = await render(
      toPdfModel({ view, budget: null, generatedOn: GENERATED_ON }),
    );
    expect(text).not.toContain('Linked bookings');
    expect(text).not.toContain('FB-ABC123');
  });

  it('marks a booking that no longer counts', async () => {
    const model = toPdfModel({
      view,
      budget,
      bookings: [
        { ...booking, status: BookingStatus.CANCELLED, counted: false },
      ],
      generatedOn: GENERATED_ON,
    });
    expect(await render(model)).toContain('not counted');
  });

  it('does not break on characters the PDF font cannot draw', async () => {
    const model = toPdfModel({
      view: { ...view, title: 'مصر 🌍 trip' },
      budget: null,
      generatedOn: GENERATED_ON,
    });
    const pdf = await renderItineraryPdf(model);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  // 60 days of activities cannot fit on one page.
  it('flows a long itinerary onto more pages', async () => {
    const days = Array.from({ length: 60 }, (_, i) =>
      day(i + 1, 'cairo', [{ id: `a${i}`, name: `Activity ${i}`, images: [] }]),
    );
    const model = toPdfModel({
      view: { ...view, days } as unknown as ItineraryView,
      budget: null,
      generatedOn: GENERATED_ON,
    });
    const pdf = await renderItineraryPdf(model, { compress: false });
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [])
      .length;
    expect(pages).toBeGreaterThan(1);
  });
});
