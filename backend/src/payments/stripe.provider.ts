import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Injection token for the Stripe client (PAY-01). */
export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

/**
 * One Stripe client (test mode). The app still boots without a key so members
 * who do not work on payments are not blocked; payment calls then fail.
 */
export const stripeProvider: Provider = {
  provide: STRIPE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Stripe => {
    // A blank `STRIPE_SECRET_KEY=` line gives an empty string, which must be
    // treated like an unset key, or Stripe's constructor throws and the app
    // cannot start.
    const key = config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      new Logger('Stripe').warn(
        'STRIPE_SECRET_KEY is not set: payments will fail until it is.',
      );
    }
    return new Stripe(key || 'sk_test_not_configured');
  },
};
