import { Injectable } from '@nestjs/common';

/** What the author page shows of one public itinerary (BLG-12). */
export interface PublicItinerarySummary {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  dayCount: number;
}

/**
 * Implemented by the itinerary module (Habashi): the author's **public**,
 * not hidden itineraries, newest first.
 *
 * @example (in ItinerariesModule)
 *   onModuleInit() { this.authorItineraries.register(this); }
 */
export interface AuthorItinerarySource {
  publicForAuthor(
    authorId: string,
    page: { skip: number; limit: number },
  ): Promise<{ items: PublicItinerarySummary[]; total: number }>;
}

/** Holds the itinerary module's source once it registers (BLG-12). */
@Injectable()
export class AuthorItineraries {
  private source?: AuthorItinerarySource;

  register(source: AuthorItinerarySource): void {
    this.source = source;
  }

  /** Empty until the itinerary module registers its source. */
  publicForAuthor(
    authorId: string,
    page: { skip: number; limit: number },
  ): Promise<{ items: PublicItinerarySummary[]; total: number }> {
    return this.source
      ? this.source.publicForAuthor(authorId, page)
      : Promise.resolve({ items: [], total: 0 });
  }
}
