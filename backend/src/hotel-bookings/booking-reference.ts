import { randomInt } from 'crypto';

/** No 0/O or 1/I, so a reference can be read out loud without mistakes. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A booking reference such as `HTL-7KQ2M9XA` (HTL-17). 32^8 combinations;
 * uniqueness is still enforced by a unique index and a retry on collision.
 */
export function newBookingReference(): string {
  let code = '';
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return `HTL-${code}`;
}
