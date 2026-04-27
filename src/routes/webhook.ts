import { Hono } from 'hono';
import type Stripe from 'stripe';
import type { AppEnv } from '../types';
import type { StripeFactory } from '../lib/stripe';
import type { SendLicenseEmail } from '../lib/resend';
import { generateLicenseKey, type LicenseRecord } from '../lib/license';
import { getPaymentLicense, putLicense, putPaymentLicense } from '../lib/kv';

export function createWebhookRoute(deps: {
  getStripe: StripeFactory;
  sendLicenseEmail: SendLicenseEmail;
}): Hono<AppEnv> {
  const route = new Hono<AppEnv>();

  route.post('/', async (c) => {
    const sig = c.req.header('Stripe-Signature');
    if (!sig) {
      return c.json({ error: 'missing_signature' }, 400);
    }

    const rawBody = await c.req.text();
    const stripe = deps.getStripe(c.env);

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, c.env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return c.json({ error: 'invalid_signature' }, 400);
    }

    if (event.type !== 'checkout.session.completed') {
      return c.body(null, 200);
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) {
      return c.body(null, 200);
    }

    const existing = await getPaymentLicense(c.env.PAYMENTS, paymentIntentId);
    if (existing) {
      return c.body(null, 200);
    }

    const email = session.customer_email ?? session.customer_details?.email ?? null;
    if (!email) {
      return c.body(null, 200);
    }

    const localeRaw = session.metadata?.locale;
    const locale: 'de' | 'en' = localeRaw === 'en' ? 'en' : 'de';
    const consentTimestamp = session.metadata?.consentTimestamp ?? new Date().toISOString();

    const key = generateLicenseKey();
    const record: LicenseRecord = {
      key,
      email,
      stripePaymentIntentId: paymentIntentId,
      issuedAt: new Date().toISOString(),
      consentWaiver: true,
      consentTimestamp,
      locale,
    };

    await putLicense(c.env.LICENSES, record);
    await putPaymentLicense(c.env.PAYMENTS, paymentIntentId, key);

    try {
      await deps.sendLicenseEmail(c.env, record);
    } catch {
      // Resend transient failure: KV is the source of truth, customer can re-fetch
      // their key via support. Never echo customer data back to Stripe error responses.
    }

    return c.body(null, 200);
  });

  return route;
}
