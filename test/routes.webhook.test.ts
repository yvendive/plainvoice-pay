import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import type Stripe from 'stripe';
import { createApp } from '../src/app';
import type { StripeClient } from '../src/lib/stripe';
import type { LicenseRecord } from '../src/lib/license';
import type { ResendEnv } from '../src/lib/resend';

type ConstructEventMock = ReturnType<
  typeof vi.fn<
    (payload: string, header: string | string[], secret: string) => Promise<Stripe.Event>
  >
>;

type SendEmailMock = ReturnType<
  typeof vi.fn<(env: ResendEnv, record: LicenseRecord) => Promise<void>>
>;

function makeStubEvent(opts: {
  paymentIntent: string;
  email: string;
  locale?: 'de' | 'en';
  consentTimestamp?: string;
}): Stripe.Event {
  return {
    id: 'evt_test',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        payment_intent: opts.paymentIntent,
        customer_email: opts.email,
        metadata: {
          locale: opts.locale ?? 'de',
          consentTimestamp: opts.consentTimestamp ?? '2026-04-27T10:00:00Z',
          consentWaiver: 'true',
        },
      },
    },
  } as unknown as Stripe.Event;
}

function buildApp(opts: {
  constructEventAsync: ConstructEventMock;
  sendLicenseEmail: SendEmailMock;
}) {
  const stripe: StripeClient = {
    checkout: {
      sessions: {
        create: async () => {
          throw new Error('not used in webhook tests');
        },
      },
    },
    webhooks: { constructEventAsync: opts.constructEventAsync },
  };
  return createApp({
    getStripe: () => stripe,
    sendLicenseEmail: opts.sendLicenseEmail,
  });
}

async function clearKv() {
  for (const ns of [env.LICENSES, env.PAYMENTS]) {
    const list = await ns.list();
    for (const k of list.keys) {
      await ns.delete(k.name);
    }
  }
}

beforeEach(async () => {
  await clearKv();
});

describe('POST /api/webhook', () => {
  it('rejects requests without a Stripe-Signature header', async () => {
    const constructEventAsync: ConstructEventMock = vi.fn();
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env,
    );

    expect(res.status).toBe(400);
    expect(constructEventAsync).not.toHaveBeenCalled();
    expect(sendLicenseEmail).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures with 400 and writes nothing', async () => {
    const constructEventAsync: ConstructEventMock = vi.fn(async () => {
      throw new Error('No signatures found matching the expected signature');
    });
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 'bogus' },
        body: '{}',
      }),
      env,
    );

    expect(res.status).toBe(400);
    expect(sendLicenseEmail).not.toHaveBeenCalled();

    const licenses = await env.LICENSES.list();
    const payments = await env.PAYMENTS.list();
    expect(licenses.keys).toHaveLength(0);
    expect(payments.keys).toHaveLength(0);
  });

  it('valid checkout.session.completed writes LicenseRecord, PAYMENTS marker, and sends email', async () => {
    const stub = makeStubEvent({
      paymentIntent: 'pi_test_abc',
      email: 'buyer@example.com',
      locale: 'de',
      consentTimestamp: '2026-04-27T10:00:00Z',
    });
    const constructEventAsync: ConstructEventMock = vi.fn(async () => stub);
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 't=1,v1=stub' },
        body: '{}',
      }),
      env,
    );

    expect(res.status).toBe(200);

    const paymentValue = await env.PAYMENTS.get('pi_test_abc');
    expect(paymentValue).toBeTruthy();
    const licenseRaw = await env.LICENSES.get(paymentValue!);
    expect(licenseRaw).toBeTruthy();
    const record = JSON.parse(licenseRaw!) as LicenseRecord;
    expect(record.email).toBe('buyer@example.com');
    expect(record.stripePaymentIntentId).toBe('pi_test_abc');
    expect(record.locale).toBe('de');
    expect(record.consentWaiver).toBe(true);
    expect(record.consentTimestamp).toBe('2026-04-27T10:00:00Z');
    expect(record.key).toMatch(/^[a-z0-9_-]{22}$/);

    expect(sendLicenseEmail).toHaveBeenCalledTimes(1);
    const callArgs = sendLicenseEmail.mock.calls[0]!;
    expect(callArgs[1].key).toBe(record.key);
  });

  it('replay of same payment_intent does not double-write or double-email', async () => {
    const stub = makeStubEvent({
      paymentIntent: 'pi_test_replay',
      email: 'buyer@example.com',
      locale: 'en',
    });
    const constructEventAsync: ConstructEventMock = vi.fn(async () => stub);
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    const reqInit = {
      method: 'POST',
      headers: { 'Stripe-Signature': 't=1,v1=stub' },
      body: '{}',
    };

    const first = await app.fetch(new Request('https://worker.test/api/webhook', reqInit), env);
    const second = await app.fetch(new Request('https://worker.test/api/webhook', reqInit), env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const licenses = await env.LICENSES.list();
    expect(licenses.keys).toHaveLength(1);
    const payments = await env.PAYMENTS.list();
    expect(payments.keys).toHaveLength(1);
    expect(sendLicenseEmail).toHaveBeenCalledTimes(1);
  });

  it('ignores non-checkout.session.completed events with 200', async () => {
    const constructEventAsync: ConstructEventMock = vi.fn(
      async () =>
        ({
          id: 'evt_other',
          type: 'payment_intent.succeeded',
          data: { object: {} },
        }) as unknown as Stripe.Event,
    );
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 't=1,v1=stub' },
        body: '{}',
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(sendLicenseEmail).not.toHaveBeenCalled();
    const licenses = await env.LICENSES.list();
    expect(licenses.keys).toHaveLength(0);
  });

  it('LICENSES.put failure after PAYMENTS.put success: returns 500 and does NOT send email', async () => {
    const stub = makeStubEvent({
      paymentIntent: 'pi_test_licenses_fail',
      email: 'buyer@example.com',
      locale: 'de',
    });
    const constructEventAsync: ConstructEventMock = vi.fn(async () => stub);
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    // Build a mock LICENSES KV where put() throws after the first call
    // (the idempotency check uses PAYMENTS, so LICENSES.get is not called first)
    const failingLicenses: KVNamespace = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {
        throw new Error('KV transient write failure');
      }),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ keys: [], list_complete: true, caret: undefined })),
      getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),
    } as unknown as KVNamespace;

    const customEnv = { ...env, LICENSES: failingLicenses };

    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 't=1,v1=stub' },
        body: '{}',
      }),
      customEnv,
    );

    // LICENSES write failed → bail with 500, no email
    expect(res.status).toBe(500);
    expect(sendLicenseEmail).not.toHaveBeenCalled();

    // PAYMENTS was written before LICENSES (correct order)
    const paymentValue = await env.PAYMENTS.get('pi_test_licenses_fail');
    expect(paymentValue).toBeTruthy(); // PI → key mapping was persisted
  });

  it('does not echo customer data in error responses', async () => {
    const constructEventAsync: ConstructEventMock = vi.fn(async () => {
      throw new Error('signature mismatch — secret_buyer@example.com');
    });
    const sendLicenseEmail: SendEmailMock = vi.fn(async () => {});
    const app = buildApp({ constructEventAsync, sendLicenseEmail });

    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: { 'Stripe-Signature': 'bad' },
        body: JSON.stringify({ customer_email: 'leak@example.com' }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('leak@example.com');
    expect(text).not.toContain('buyer@example.com');
  });
});
