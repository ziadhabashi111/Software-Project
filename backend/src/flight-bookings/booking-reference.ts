import { randomInt } from 'crypto';

/** No 0/O or 1/I, so a reference can be read out loud without mistakes. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A flight booking reference such as `FB-7KQ2M9XA` (FLT-23), set when the
 * booking is confirmed. 32^8 combinations; uniqueness is still enforced by a
 * unique index and a retry on collision.
 */
export function newFlightBookingReference(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return `FB-${code}`;
}

/** True when a write failed only because the reference already exists. */
export function isDuplicateReference(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyPattern } = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  };
  return (
    code === 11000 && keyPattern !== undefined && 'reference' in keyPattern
  );
}
