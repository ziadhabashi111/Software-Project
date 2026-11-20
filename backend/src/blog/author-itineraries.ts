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
 * An itinerary a post links to, as the post's author sees it (BLG-13):
 * `isPublic` is false once the author makes it private again or a moderator
 * hides it, which is when readers stop seeing the link.
 */
export interface LinkedItinerary extends PublicItinerarySummary {
  isPublic: boolean;
}

/**
 * Implemented by the itinerary module (Habashi): the author's **public**,
 * not hidden itineraries, newest first (BLG-12), and what a post needs to
 * link to one (BLG-13).
 *
 * @example (in ItinerariesModule)
 *   onModuleInit() { this.authorItineraries.register(this); }
 */
export interface AuthorItinerarySource {
  publicForAuthor(
    authorId: string,
    page: { skip: number; limit: number },
  ): Promise<{ items: PublicItinerarySummary[]; total: number }>;

  /**
   * The author's own itinerary, public or not, or null when there is no such
   * itinerary of theirs (someone else's looks the same as a missing one).
   */
  ownedBy(
    authorId: string,
    itineraryId: string,
  ): Promise<LinkedItinerary | null>;

  /**
   * The itinerary's summary, only while everyone may see it: public, not
   * hidden and its owner active. Null otherwise.
   */
  publicSummary(itineraryId: string): Promise<PublicItinerarySummary | null>;
}

/** Holds the itinerary module's source once it registers (BLG-12, BLG-13). */
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

  /** BLG-13. Null until the itinerary module registers its source. */
  ownedBy(
    authorId: string,
    itineraryId: string,
  ): Promise<LinkedItinerary | null> {
    return this.source
      ? this.source.ownedBy(authorId, itineraryId)
      : Promise.resolve(null);
  }

  /** BLG-13. Null until the itinerary module registers its source. */
  publicSummary(itineraryId: string): Promise<PublicItinerarySummary | null> {
    return this.source
      ? this.source.publicSummary(itineraryId)
      : Promise.resolve(null);
  }
}
