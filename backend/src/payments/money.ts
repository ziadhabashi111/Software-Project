/** Stripe wants the smallest currency unit (cents). */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}
