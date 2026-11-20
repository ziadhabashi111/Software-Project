import { AuthorItineraries } from './author-itineraries';
import type {
  AuthorItinerarySource,
  LinkedItinerary,
} from './author-itineraries';

const summary = {
  id: 'i1',
  title: 'A week in Egypt',
  countries: ['EG'],
  startDate: '2027-03-01',
  dayCount: 7,
};

function source(): AuthorItinerarySource {
  return {
    publicForAuthor: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    ownedBy: jest.fn(),
    publicSummary: jest.fn(),
  };
}

describe('AuthorItineraries (BLG-12, BLG-13)', () => {
  // Until the itinerary module registers, a post can link nothing and shows
  // nothing, instead of failing.
  it('answers "nothing" for every question before a source registers', async () => {
    const authors = new AuthorItineraries();
    expect(await authors.publicForAuthor('a', { skip: 0, limit: 5 })).toEqual({
      items: [],
      total: 0,
    });
    expect(await authors.ownedBy('a', 'i1')).toBeNull();
    expect(await authors.publicSummary('i1')).toBeNull();
  });

  it('asks the registered source who owns an itinerary', async () => {
    const authors = new AuthorItineraries();
    const found: LinkedItinerary = { ...summary, isPublic: true };
    const ownedBy = jest.fn().mockResolvedValue(found);
    authors.register({ ...source(), ownedBy });
    expect(await authors.ownedBy('a', 'i1')).toEqual(found);
    expect(ownedBy).toHaveBeenCalledWith('a', 'i1');
  });

  it('asks the registered source for the public summary', async () => {
    const authors = new AuthorItineraries();
    const publicSummary = jest.fn().mockResolvedValue(summary);
    authors.register({ ...source(), publicSummary });
    expect(await authors.publicSummary('i1')).toEqual(summary);
    expect(publicSummary).toHaveBeenCalledWith('i1');
  });
});
