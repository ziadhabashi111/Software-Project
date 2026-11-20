import type { ConfigService } from '@nestjs/config';
import type { FactoryProvider } from '@nestjs/common';
import { stripeProvider } from './stripe.provider';

const build = (key: string | undefined) => {
  const config = {
    get: (name: string) => (name === 'STRIPE_SECRET_KEY' ? key : undefined),
  } as unknown as ConfigService;
  return (stripeProvider as FactoryProvider).useFactory(config) as unknown;
};

/**
 * PAY-01: the app must boot without a Stripe key (members who do not work on
 * payments, and graders without a key); payment calls fail later instead.
 */
describe('stripeProvider', () => {
  it('creates a client when the key is not set', () => {
    expect(() => build(undefined)).not.toThrow();
  });

  // A `.env` line such as `STRIPE_SECRET_KEY=` gives an empty string, not undefined.
  it('creates a client when the key is blank', () => {
    expect(() => build('')).not.toThrow();
  });

  it('creates a client when the key is only whitespace', () => {
    expect(() => build('   ')).not.toThrow();
  });

  it('creates a client from a real-looking test key', () => {
    expect(() => build('sk_test_dummy_not_real')).not.toThrow();
  });
});
