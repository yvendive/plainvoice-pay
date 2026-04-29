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

    // Write PAYMENTS first so that if LICENSES write subsequently fails,
    // support can still find the issued key from the payment-intent ID.
    // Reversed order (LICENSES first) creates orphan licenses with no PI
    // binding — refund/GDPR-deletion flow breaks in that case.
    try {
      await putPaymentLicense(c.env.PAYMENTS, paymentIntentId, key);
    } catch (err) {
      console.error('webhook.payments_write_failed', {
        paymentIntentId,
        message: err instanceof Error ? err.message : String(err),
      });
      // Bail with 500 — no LICENSES write, no email, Stripe will retry.
      return c.body(null, 500);
    }

    try {
      await putLicense(c.env.LICENSES, record);
    } catch (err) {
      // PAYMENTS is already written; support can reconcile using the PI.
      console.error('webhook.licenses_write_failed', { paymentIntentId });
      // Bail with 500 — no email sent, Stripe retries; PAYMENTS-already-set
      // check at the top of the next delivery handles idempotency.
      return c.body(null, 500);
    }

    // ACCEPTED v1 RISK: parallel webhook deliveries may both miss the PAYMENTS
    // check before either write completes. Mitigation would require a Durable
    // Object or compare-and-set primitive; deferred until post-launch metrics
    // justify the cost. See docs/security/pentest-issues-2026-04-29.md
    // "Findings not filed".

    try {
      await deps.sendLicenseEmail(c.env, record);
    } catch (err) {
      console.error('resend.send_failed', {
        paymentIntentId: record.stripePaymentIntentId,
        message: err instanceof Error ? err.message : String(err),
      });
      // KV is the source of truth — customer can re-fetch via support.
      // Stripe webhook still returns 200 to avoid re-deliveries.
    }

    return c.body(null, 200);
  });

  return route;
}
