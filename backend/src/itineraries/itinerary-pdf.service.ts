import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../auth/auth.types';
import type { AuthUser } from '../auth/auth.types';
import { BudgetSummaryService } from './budget/budget-summary.service';
import type { BudgetSummaryView } from './budget/budget-summary.service';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import { pdfFilename, renderItineraryPdf, toPdfModel } from './itinerary-pdf';
import type { PdfModel } from './itinerary-pdf';
import { PublicItinerariesService } from './public-itineraries.service';

/**
 * ITN-28 (optional bonus): the PDF of an itinerary.
 *
 * - The owner gets everything: days, the linked bookings (ITN-27) and the
 *   budget the way they see it.
 * - Anyone else, signed in or not, gets exactly what the public page shows
 *   (author, days, public budget) and only if the itinerary is public, not
 *   hidden and its author active. Never the owner's bookings.
 * - Anything else is 404, so a private itinerary's existence is not revealed.
 *
 * Staff accounts and users who are not the owner always get the public copy,
 * so the PDF can never show more than the JSON endpoints already do.
 */
@Injectable()
export class ItineraryPdfService {
  private readonly logger = new Logger(ItineraryPdfService.name);

  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly budgets: BudgetSummaryService,
    private readonly bookings: ItineraryBookingsService,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  async model(
    viewer: AuthUser | undefined,
    id: string,
    currency?: string,
    now: Date = new Date(),
  ): Promise<PdfModel> {
    const generatedOn = now.toISOString().slice(0, 10);

    if (viewer?.role === Role.USER) {
      try {
        const view = await this.itineraries.get(viewer, id);
        const [budget, bookings] = await Promise.all([
          this.ownerBudget(viewer, id, currency),
          this.bookings.list(viewer, id),
        ]);
        return toPdfModel({ view, budget, bookings, generatedOn });
      } catch (error) {
        // Not the owner's: fall through to the public copy.
        if (!(error instanceof NotFoundException)) throw error;
      }
    }

    const view = await this.publicItineraries.get(id, currency);
    return toPdfModel({ view, budget: view.budget, generatedOn });
  }

  async pdf(
    viewer: AuthUser | undefined,
    id: string,
    currency?: string,
    now: Date = new Date(),
  ): Promise<{ filename: string; pdf: Buffer }> {
    const model = await this.model(viewer, id, currency, now);
    return {
      filename: pdfFilename(model.title),
      pdf: await renderItineraryPdf(model),
    };
  }

  /** A missing exchange rate leaves the budget out; it never blocks the PDF. */
  private async ownerBudget(
    viewer: AuthUser,
    id: string,
    currency?: string,
  ): Promise<BudgetSummaryView | null> {
    try {
      return await this.budgets.summary(viewer, id, currency);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `Could not load the budget for the PDF of itinerary ${id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
