import { Hono } from 'hono';
import type { AppEnv } from './types';
import type { StripeFactory } from './lib/stripe';
import type { SendLicenseEmail } from './lib/resend';
import { createCheckoutRoute } from './routes/checkout';
import { createWebhookRoute } from './routes/webhook';
import { createVerifyRoute } from './routes/verify';

export type AppDeps = {
  getStripe: StripeFactory;
  sendLicenseEmail: SendLicenseEmail;
};

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/api/checkout', createCheckoutRoute({ getStripe: deps.getStripe }));
  app.route('/api/webhook', createWebhookRoute(deps));
  app.route('/api/verify', createVerifyRoute());

  return app;
}
