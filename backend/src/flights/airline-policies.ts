import { fieldError } from '../common/validation/validation-errors';
import type { CancellationTier } from './schemas/airline.schema';

/** Most tiers one airline can define; keeps the policy readable at checkout. */
export const MAX_CANCELLATION_TIERS = 20;

/**
 * FLT-09: every tier needs its own days-before-departure threshold. Returns
 * the tiers sorted from the longest notice to the shortest, so readers see
 * the policy the way the refund rule applies it.
 */
export function normalizeTiers(tiers: CancellationTier[]): CancellationTier[] {
  const seen = new Set<number>();
  for (const [index, tier] of tiers.entries()) {
    if (seen.has(tier.daysBefore)) {
      throw fieldError(
        `tiers.${index}.daysBefore`,
        `Another tier already uses ${tier.daysBefore} days before departure`,
      );
    }
    seen.add(tier.daysBefore);
  }
  return [...tiers]
    .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
    .sort((a, b) => b.daysBefore - a.daysBefore);
}

/**
 * FLT-09 refund rule: the tier with the highest threshold that does not
 * exceed the days remaining; 0% when no tier applies. The refund service
 * (PAY-03) uses the same rule, exported here so it is tested in one place.
 */
export function refundPercentFor(
  tiers: CancellationTier[],
  daysRemaining: number,
): number {
  let best: CancellationTier | undefined;
  for (const tier of tiers) {
    if (tier.daysBefore <= daysRemaining) {
      if (!best || tier.daysBefore > best.daysBefore) best = tier;
    }
  }
  return best ? best.refundPercent : 0;
}
