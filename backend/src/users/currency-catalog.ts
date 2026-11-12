/** Injection token for the list of supported currencies (GEN-12). */
export const CURRENCY_CATALOG = 'CURRENCY_CATALOG';

/**
 * Provided by the reference-data module once the seed has loaded the
 * currencies from the official countries dataset. Until it exists the profile
 * only checks that a preferred currency looks like a 3-letter code.
 */
export interface CurrencyCatalog {
  isSupported(code: string): Promise<boolean>;
}
