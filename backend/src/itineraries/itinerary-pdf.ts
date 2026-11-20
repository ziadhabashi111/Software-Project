import PDFDocument from 'pdfkit';
import { LinkedBookingType } from './booking-links';
import { BudgetCategory } from './budget/budget-categories';
import { INTERCITY_TRANSPORT } from './budget/budget-summary';
import type { SummaryCategory } from './budget/budget-summary';
import type { BudgetSummaryView } from './budget/budget-summary.service';
import type { LinkedBookingView } from './itinerary-booking-view';
import type { ItineraryView } from './itinerary-view';
import type { PublicItineraryView } from './public-itinerary-view';

/**
 * ITN-28 (optional bonus): the downloadable PDF of an itinerary. The renderer
 * only draws a model; `toPdfModel` decides what goes into it, so what a PDF may
 * contain (an owner's bookings and budget, a visitor's public copy) is decided
 * in one place and is testable without parsing a PDF.
 */

export interface PdfActivity {
  name: string;
  description?: string;
  time?: string;
  cost?: number;
  currency?: string;
}

export interface PdfDay {
  number: number;
  date: string;
  city: string;
  notes?: string;
  activities: PdfActivity[];
}

export interface PdfModel {
  title: string;
  /** Present for a public itinerary: its author's display name. */
  author?: string;
  countries: string[];
  startDate: string;
  endDate: string;
  generatedOn: string;
  days: PdfDay[];
  budget: BudgetSummaryView | null;
  /** Only the owner's PDF carries linked bookings (ITN-27). */
  bookings?: LinkedBookingView[];
}

export interface PdfModelInput {
  view: ItineraryView | PublicItineraryView;
  budget: BudgetSummaryView | null;
  bookings?: LinkedBookingView[];
  /** `YYYY-MM-DD`, passed in so the model is deterministic. */
  generatedOn: string;
}

export function toPdfModel(input: PdfModelInput): PdfModel {
  const { view } = input;
  const days: PdfDay[] = view.days.map((day) => ({
    number: day.number,
    date: day.date,
    city: day.city,
    notes: day.notes,
    activities: day.activities.map((activity) => ({
      name: activity.name,
      description: activity.description,
      time: activity.time,
      cost: activity.cost,
      currency: activity.currency,
    })),
  }));
  return {
    title: view.title,
    author: 'author' in view ? view.author.name : undefined,
    countries: view.countries,
    startDate: view.startDate,
    endDate: days.length > 0 ? days[days.length - 1].date : view.startDate,
    generatedOn: input.generatedOn,
    days,
    budget: input.budget,
    bookings: input.bookings,
  };
}

/**
 * The file name offered to the browser. It goes into a response header, so only
 * lower-case letters, digits and single dashes survive.
 */
export function pdfFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 50)
    .replace(/-+$/, '');
  return slug ? `itinerary-${slug}.pdf` : 'itinerary.pdf';
}

/**
 * The built-in PDF fonts only cover Latin-1, so anything else is drawn as `?`
 * rather than as garbage; line breaks become spaces and control characters are
 * dropped.
 */
export function printable(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/[\r\n]+/g, ' ')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return '';
      return code > 0xff ? '?' : char;
    })
    .join('');
}

const CATEGORY_LABELS: Array<[SummaryCategory, string]> = [
  [BudgetCategory.FOOD, 'Food'],
  [BudgetCategory.ACCOMMODATION, 'Accommodation'],
  [BudgetCategory.IN_CITY_TRANSPORT, 'In-city transport'],
  [BudgetCategory.ACTIVITIES, 'Activities'],
  [INTERCITY_TRANSPORT, 'Intercity transport'],
];

const money = (amount: number, currency: string) =>
  `${amount.toFixed(2)} ${currency}`;

export function renderItineraryPdf(
  model: PdfModel,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress: options.compress ?? true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const write = (size: number, text: string) =>
      doc.fontSize(size).text(printable(text));

    write(22, model.title);
    doc.moveDown(0.3);
    if (model.author) write(11, `By ${model.author}`);
    write(11, `${model.startDate} to ${model.endDate}`);
    if (model.countries.length > 0) {
      write(11, `Countries: ${model.countries.join(', ')}`);
    }

    for (const day of model.days) {
      doc.moveDown();
      write(14, `Day ${day.number} - ${day.date} - ${day.city}`);
      if (day.notes) write(10, day.notes);
      if (day.activities.length === 0) write(11, 'No activities planned.');
      for (const activity of day.activities) {
        const when = activity.time ? `${activity.time} ` : '';
        const cost =
          activity.cost !== undefined && activity.cost !== null
            ? ` (${money(activity.cost, activity.currency ?? 'USD')})`
            : '';
        write(11, `${when}${activity.name}${cost}`);
        if (activity.description) write(10, `    ${activity.description}`);
      }
    }

    if (model.bookings && model.bookings.length > 0) {
      doc.moveDown();
      write(14, 'Linked bookings');
      for (const booking of model.bookings) {
        const kind =
          booking.bookingType === LinkedBookingType.FLIGHT ? 'Flight' : 'Hotel';
        const day = booking.dayNumber ? `Day ${booking.dayNumber}: ` : '';
        const dates =
          booking.startDate === booking.endDate
            ? booking.startDate
            : `${booking.startDate} to ${booking.endDate}`;
        const note = booking.counted ? '' : ' [not counted in the budget]';
        write(
          11,
          `${day}${kind} ${booking.reference ?? '-'}: ${booking.title}, ${dates}, ${money(booking.amount, booking.currency)}, ${booking.status}${note}`,
        );
      }
    }

    if (model.budget) {
      doc.moveDown();
      write(14, `Budget (${model.budget.currency})`);
      for (const [key, label] of CATEGORY_LABELS) {
        write(
          11,
          `${label}: ${money(model.budget.totals[key], model.budget.currency)}`,
        );
      }
      write(
        12,
        `Total: ${money(model.budget.totals.total, model.budget.currency)}`,
      );
      if (model.budget.rateDate) {
        write(
          9,
          `Exchange rates of ${model.budget.rateDate}${model.budget.ratesStale ? ' (provider unavailable, cached rates used)' : ''}`,
        );
      }
    }

    doc.moveDown();
    write(9, `Generated on ${model.generatedOn}`);
    doc.end();
  });
}
