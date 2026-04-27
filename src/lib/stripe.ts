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

export const getStripe: StripeFactory = (env) => {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  return stripe as unknown as StripeClient;
};
