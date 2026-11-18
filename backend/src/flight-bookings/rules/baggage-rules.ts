import { fieldError } from '../../common/validation/validation-errors';

/**
 * FLT-19 / FLT-08: extra bags up to the airline's maximum per passenger (none
 * when the airline has no baggage policy). Each extra bag may weigh up to the
 * cabin's free-bag allowance, so the weight is required with any extra bag.
 */
export function assertBaggage(
  index: number,
  extraBags: number,
  weightKg: number | undefined,
  policy: { extraBagPrice: number; maxExtraBags: number } | undefined,
  maxBagWeightKg: number,
): void {
  if (extraBags === 0) return;
  const max = policy?.maxExtraBags ?? 0;
  if (extraBags > max) {
    throw fieldError(
      `passengers.${index}.extraBags`,
      max === 0
        ? 'This airline does not sell extra bags'
        : `At most ${max} extra bags per passenger`,
    );
  }
  if (weightKg === undefined) {
    throw fieldError(
      `passengers.${index}.extraBagWeightKg`,
      'Enter the weight of the extra bags',
    );
  }
  if (weightKg > maxBagWeightKg) {
    throw fieldError(
      `passengers.${index}.extraBagWeightKg`,
      `Each extra bag can weigh at most ${maxBagWeightKg} kg`,
    );
  }
}
