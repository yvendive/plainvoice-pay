import Stripe from 'stripe';
import type { Bindings } from '../types';

export type CheckoutSessionParams = Stripe.Checkout.SessionCreateParams;
export type CheckoutSessionResult = { id: string; url: string | null };

export type StripeClient = {
  checkout: {
    sessions: {
      create(params: CheckoutSessionParams): Promise<CheckoutSessionResult>;
    };
  };
  webhooks: {
    constructEventAsync(
      payload: string,
      header: string | string[],
      secret: string,
    ): Promise<Stripe.Event>;
  };
};

export type StripeFactory = (env: Pick<Bindings, 'STRIPE_SECRET_KEY'>) => StripeClient;

// Pinned API version. Upgrades require deliberate compatibility PR — see issue #5.
export const getStripe: StripeFactory = (env) => {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    // Sourced from stripe npm package v17.7.0 (LatestApiVersion).
    // Cross-check against Stripe Dashboard → Developers → API version
    // for acct_1TQrJMLJIGoQ4ULV before merging — Yves confirms.
    apiVersion: '2025-02-24.acacia',
  });
  return stripe as unknown as StripeClient;
};
