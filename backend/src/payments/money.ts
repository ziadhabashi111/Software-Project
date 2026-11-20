/** Stripe wants the smallest currency unit (cents). */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Stripe's smallest currency unit (cents) back to major units. */
export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}
