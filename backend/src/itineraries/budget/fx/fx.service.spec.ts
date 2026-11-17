import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import { ExchangeRates } from './exchange-rates.schema';
import { FxService } from './fx.service';

const iso = (daysAgo: number): Date =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

const cachedDoc = (fetchedAt: Date) => ({
  base: 'USD',
  rates: { EUR: 0.9 },
  rateDate: '2026-11-10',
  fetchedAt,
});

function apiAnswer(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const freshBody = {
  success: true,
  base: 'USD',
  date: '2026-11-17T20:19:00.000Z',
  rates: { EUR: 0.91, EGP: 53.7, bad: 1, GBP: -2 },
};

function build(cached: ReturnType<typeof cachedDoc> | null, key?: string) {
  const model = {
    findOne: jest.fn().mockResolvedValue(cached),
    findOneAndUpdate: jest
      .fn()
      .mockImplementation(
        (_filter: unknown, update: { $set: Record<string, unknown> }) =>
          Promise.resolve({ base: 'USD', ...update.$set }),
      ),
  };
  const config = { get: jest.fn().mockReturnValue(key) };
  const service = new FxService(
    model as unknown as Model<ExchangeRates>,
    config as unknown as ConfigService,
  );
  return { service, model };
}

describe('FxService (ITN-18)', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses rates cached today without calling the API', async () => {
    const { service } = build(cachedDoc(new Date()));
    const table = await service.getRates();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(table).toMatchObject({ stale: false, rateDate: '2026-11-10' });
  });

  it('fetches once when the cache is from an earlier day, then stores the rates and their date', async () => {
    fetchMock.mockResolvedValue(apiAnswer(freshBody));
    const { service, model } = build(cachedDoc(iso(2)));
    const table = await service.getRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(table).toMatchObject({ stale: false, rateDate: '2026-11-17' });
    // malformed or non-positive rates are dropped
    expect(table.rates).toEqual({ EUR: 0.91, EGP: 53.7 });
    const update = (model.findOneAndUpdate.mock.calls[0] as unknown[])[1] as {
      $set: { rateDate: string };
    };
    expect(update.$set.rateDate).toBe('2026-11-17');
  });

  it('failure case 3a: API down, so the last cached rates are used and flagged stale with their date', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { service } = build(cachedDoc(iso(3)));
    await expect(service.getRates()).resolves.toMatchObject({
      stale: true,
      rateDate: '2026-11-10',
      rates: { EUR: 0.9 },
    });
  });

  it('failure case 3b: API errors (HTTP 500, success false, empty rates) also fall back to the cache', async () => {
    const { service } = build(cachedDoc(iso(3)));
    for (const answer of [
      apiAnswer({}, false, 500),
      apiAnswer({ success: false, error: 'quota_reached' }),
      apiAnswer({ success: true, date: '2026-11-17', rates: {} }),
    ]) {
      fetchMock.mockResolvedValueOnce(answer);
      await expect(service.getRates()).resolves.toMatchObject({ stale: true });
    }
  });

  it('failure case 3c: API down and nothing cached is a clear 503', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { service } = build(null);
    await expect(service.getRates()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.getRates()).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'RATES_UNAVAILABLE',
      }) as unknown,
    });
  });

  it('shares one fetch between simultaneous requests', async () => {
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const { service } = build(null);
    const calls = [service.getRates(), service.getRates(), service.getRates()];
    await new Promise((resolve) => setImmediate(resolve));
    release(apiAnswer(freshBody));
    await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the key in a header, never in the URL, and skips a placeholder key', async () => {
    fetchMock.mockResolvedValue(apiAnswer(freshBody));
    await build(null, 'fxr_live_secret').service.getRates();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('fxr_live_secret');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer fxr_live_secret',
    );

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(apiAnswer(freshBody));
    await build(null, '<fxrates-api-key>').service.getRates();
    const [, placeholderInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(placeholderInit.headers).toEqual({});
  });
});
