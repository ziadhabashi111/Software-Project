import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../../../payments/platform-currency';
import type { RateTable } from './currency-math';
import { ExchangeRates } from './exchange-rates.schema';

const API_URL = 'https://api.fxratesapi.com/latest';
const REQUEST_TIMEOUT_MS = 8000;
/**
 * After a failed refresh, cached rates are served straight away for this long
 * before the API is tried again, so an outage does not make every itinerary
 * read wait for the request timeout.
 */
export const FAILED_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/** The provider's answer, as far as we rely on it. */
interface ApiResponse {
  success?: boolean;
  base?: string;
  date?: string;
  rates?: Record<string, unknown>;
  error?: string;
  description?: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * ITN-18: exchange rates fetched once per day from FXRatesAPI and cached in
 * the database. The API key stays in the backend (`FXRATES_API_KEY`) and is
 * never sent to the frontend. If the API is down the last cached rates are
 * used and flagged `stale`; with no cache at all the caller gets a 503.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private refreshing?: Promise<RateTable | null>;
  /** When the last refresh failed (ms since epoch); cleared by a success. */
  private lastFailureAt?: number;

  constructor(
    @InjectModel(ExchangeRates.name)
    private readonly model: Model<ExchangeRates>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Today's rates: from the cache when fetched today, otherwise fetched once.
   * Right after a failed fetch the cached rates are returned as stale without
   * calling the API again until the cooldown is over.
   */
  async getRates(): Promise<RateTable> {
    const cached = await this.model.findOne({ base: PLATFORM_CURRENCY });
    if (cached && cached.fetchedAt.toISOString().slice(0, 10) === today()) {
      return toTable(cached, false);
    }
    if (cached && this.inCooldown()) return toTable(cached, true);

    const fresh = await this.refresh();
    if (fresh) return fresh;
    if (cached) return toTable(cached, true);

    throw new ServiceUnavailableException({
      statusCode: 503,
      error: 'Service Unavailable',
      message:
        'Exchange rates are not available right now and none are cached yet. Try again later.',
      code: 'RATES_UNAVAILABLE',
    });
  }

  /** The daily refresh, so the first request of the day does not wait for the API. */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async dailyRefresh(): Promise<void> {
    await this.refresh();
  }

  /**
   * Fetches and stores new rates. Requests that arrive while a fetch is
   * running share it, so a burst never calls the API twice. Returns null
   * when the API cannot be used (the reason is logged) and remembers the
   * failure for `FAILED_REFRESH_COOLDOWN_MS`.
   */
  refresh(): Promise<RateTable | null> {
    this.refreshing ??= this.fetchAndStore().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async fetchAndStore(): Promise<RateTable | null> {
    try {
      const body = await this.fetchRates();
      const rates = cleanRates(body.rates);
      if (!body.success || !body.date || Object.keys(rates).length === 0) {
        throw new Error(
          `FXRatesAPI answered without usable rates (${body.error ?? 'no error given'}${body.description ? `: ${body.description}` : ''})`,
        );
      }
      const doc = await this.model.findOneAndUpdate(
        { base: PLATFORM_CURRENCY },
        {
          $set: {
            rates,
            rateDate: body.date.slice(0, 10),
            fetchedAt: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );
      if (!doc) throw new Error('the rates could not be stored');
      this.lastFailureAt = undefined;
      return toTable(doc, false);
    } catch (error) {
      this.lastFailureAt = Date.now();
      this.logger.warn(
        `Could not refresh the exchange rates, using the cached ones: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private inCooldown(): boolean {
    return (
      this.lastFailureAt !== undefined &&
      Date.now() - this.lastFailureAt < FAILED_REFRESH_COOLDOWN_MS
    );
  }

  private async fetchRates(): Promise<ApiResponse> {
    const key = this.config.get<string>('FXRATES_API_KEY');
    const response = await fetch(`${API_URL}?base=${PLATFORM_CURRENCY}`, {
      // The key goes in a header so it never appears in URLs or logs.
      headers:
        key && !key.startsWith('<') ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`FXRatesAPI answered HTTP ${response.status}`);
    }
    return (await response.json()) as ApiResponse;
  }
}

function cleanRates(
  raw: Record<string, unknown> | undefined,
): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw ?? {})) {
    if (/^[A-Z]{3}$/.test(code) && typeof value === 'number' && value > 0) {
      rates[code] = value;
    }
  }
  return rates;
}

function toTable(doc: ExchangeRates, stale: boolean): RateTable {
  return { base: doc.base, rates: doc.rates, rateDate: doc.rateDate, stale };
}
