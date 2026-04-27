export type Bindings = {
  LICENSES: KVNamespace;
  PAYMENTS: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  RESEND_API_KEY: string;
  RESEND_FROM_ADDRESS: string;
  FRONTEND_URL: string;
  ALLOWED_ORIGINS: string;
};

export type AppEnv = { Bindings: Bindings };
