import { Hono } from 'hono';
import type { AppEnv } from '../types';
import type { StripeFactory } from '../lib/stripe';
import { corsFromEnv } from '../lib/cors';

type CheckoutBody = {
  email: string;
  locale: 'de' | 'en';
  consentWaiver: true;
  consentTimestamp: string;
};

export function createCheckoutRoute(deps: { getStripe: StripeFactory }): Hono<AppEnv> {
  const route = new Hono<AppEnv>();

  route.use('*', corsFromEnv);

  route.post('/', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const parsed = parseCheckoutBody(raw);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }

    const { email, locale, consentTimestamp } = parsed.value;
    const stripe = deps.getStripe(c.env);

    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
        customer_email: email,
        locale,
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        invoice_creation: { enabled: true },
        success_url: `${c.env.FRONTEND_URL}/${locale}/unlocked?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${c.env.FRONTEND_URL}/${locale}/buy?cancelled=1`,
        metadata: {
          consentWaiver: 'true',
          consentTimestamp,
          locale,
        },
      });
    } catch {
      return c.json({ error: 'stripe_error' }, 502);
    }

    if (!session.url) {
      return c.json({ error: 'session_url_missing' }, 502);
    }
    return c.json({ url: session.url });
  });

  return route;
}

type ParseResult = { ok: true; value: CheckoutBody } | { ok: false; error: string };

function parseCheckoutBody(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_body' };
  const body = raw as Record<string, unknown>;

  if (typeof body.email !== 'string' || !isEmail(body.email)) {
    return { ok: false, error: 'invalid_email' };
  }
  if (body.locale !== 'de' && body.locale !== 'en') {
    return { ok: false, error: 'invalid_locale' };
  }
  if (body.consentWaiver !== true) {
    return { ok: false, error: 'consent_required' };
  }
  if (typeof body.consentTimestamp !== 'string' || !isIsoDate(body.consentTimestamp)) {
    return { ok: false, error: 'invalid_consent_timestamp' };
  }

  return {
    ok: true,
    value: {
      email: body.email,
      locale: body.locale,
      consentWaiver: true,
      consentTimestamp: body.consentTimestamp,
    },
  };
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isIsoDate(s: string): boolean {
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
}
