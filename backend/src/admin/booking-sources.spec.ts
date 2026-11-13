import {
  AdminBookingQuery,
  AdminBookingRecord,
  BookingSource,
  BookingSources,
} from './booking-sources';

function record(
  type: 'flight' | 'hotel',
  day: number,
  status = 'Confirmed',
): AdminBookingRecord {
  return {
    id: `${type}-${day}`,
    reference: `${type}-${day}`,
    type,
    userId: 'u1',
    provider: { id: 'p', name: 'Provider' },
    startDate: new Date(Date.UTC(2027, 0, day)),
    amount: 10,
    currency: 'EGP',
    status,
    createdAt: new Date(Date.UTC(2026, 10, day)),
  };
}

function source(
  type: 'flight' | 'hotel',
  rows: AdminBookingRecord[],
  asked: AdminBookingQuery[] = [],
): BookingSource {
  return {
    type,
    find: (query) => {
      asked.push(query);
      const matching = rows
        .filter((row) => !query.status || row.status === query.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve({
        items: matching.slice(query.skip, query.skip + query.limit),
        total: matching.length,
      });
    },
  };
}

describe('BookingSources (ACC-17)', () => {
  it('returns an empty page when no booking module is connected', async () => {
    const result = await new BookingSources().list({}, { page: 1, limit: 10 });
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 10 });
  });

  it('merges every source newest first and adds up the totals', async () => {
    const sources = new BookingSources();
    sources.register(
      source('flight', [record('flight', 1), record('flight', 4)]),
    );
    sources.register(source('hotel', [record('hotel', 2), record('hotel', 3)]));
    const result = await sources.list({}, { page: 1, limit: 10 });
    expect(result.total).toBe(4);
    expect(result.items.map((b) => b.id)).toEqual([
      'flight-4',
      'hotel-3',
      'hotel-2',
      'flight-1',
    ]);
  });

  it('cuts the second page from the merged list, not from each source', async () => {
    const sources = new BookingSources();
    const flightAsked: AdminBookingQuery[] = [];
    sources.register(
      source('flight', [record('flight', 1), record('flight', 4)], flightAsked),
    );
    sources.register(source('hotel', [record('hotel', 2), record('hotel', 3)]));
    const result = await sources.list({}, { page: 2, limit: 2 });
    expect(result.items.map((b) => b.id)).toEqual(['hotel-2', 'flight-1']);
    expect(flightAsked[0]).toEqual({ skip: 0, limit: 4 });
  });

  it('gives an empty page past the end but still reports the total', async () => {
    const sources = new BookingSources();
    sources.register(source('flight', [record('flight', 1)]));
    const result = await sources.list({}, { page: 5, limit: 10 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(1);
  });

  it('only asks the sources of the requested type and forwards the filters', async () => {
    const sources = new BookingSources();
    const flightAsked: AdminBookingQuery[] = [];
    const hotelAsked: AdminBookingQuery[] = [];
    sources.register(source('flight', [record('flight', 1)], flightAsked));
    sources.register(
      source('hotel', [record('hotel', 2, 'Cancelled')], hotelAsked),
    );
    const from = new Date('2027-01-01T00:00:00Z');
    const result = await sources.list(
      { type: 'hotel', status: 'Cancelled', from },
      { page: 1, limit: 10 },
    );
    expect(result.total).toBe(1);
    expect(flightAsked).toHaveLength(0);
    expect(hotelAsked[0]).toEqual({
      status: 'Cancelled',
      from,
      skip: 0,
      limit: 10,
    });
  });
});
