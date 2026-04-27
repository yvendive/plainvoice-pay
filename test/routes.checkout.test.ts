import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/app';
import type { CheckoutSessionParams, CheckoutSessionResult, StripeClient } from '../src/lib/stripe';

type CreateMock = ReturnType<
  typeof vi.fn<(params: CheckoutSessionParams) => Promise<CheckoutSessionResult>>
>;

function buildApp(create: CreateMock) {
  const stripe: StripeClient = {
    checkout: { sessions: { create } },
    webhooks: {
      constructEventAsync: async () => {
        throw new Error('not used in checkout tests');
      },
    },
  };
  return createApp({
    getStripe: () => stripe,
    sendLicenseEmail: vi.fn(async () => {}),
  });
}

const validBody = {
  email: 'buyer@example.com',
  locale: 'de' as const,
  consentWaiver: true as const,
  consentTimestamp: '2026-04-27T10:00:00Z',
};

describe('POST /api/checkout', () => {
  it('happy path returns the Stripe Checkout URL', async () => {
    const create: CreateMock = vi.fn(async () => ({
      id: 'cs_test_xyz',
      url: 'https://checkout.stripe.com/c/pay/cs_test_xyz',
    }));
    const app = buildApp(create);

    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify(validBody),
      }),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe('https://checkout.stripe.com/c/pay/cs_test_xyz');

    expect(create).toHaveBeenCalledTimes(1);
    const args = create.mock.calls[0]![0]!;
    expect(args.mode).toBe('payment');
    expect(args.customer_email).toBe('buyer@example.com');
    expect(args.locale).toBe('de');
    expect(args.line_items).toEqual([{ price: env.STRIPE_PRICE_ID, quantity: 1 }]);
    expect(args.automatic_tax).toEqual({ enabled: true });
    expect(args.tax_id_collection).toEqual({ enabled: true });
    expect(args.invoice_creation).toEqual({ enabled: true });
    expect(args.success_url).toContain('/de/unlocked?session_id={CHECKOUT_SESSION_ID}');
    expect(args.cancel_url).toContain('/de/buy?cancelled=1');
    expect(args.metadata).toEqual({
      consentWaiver: 'true',
      consentTimestamp: '2026-04-27T10:00:00Z',
      locale: 'de',
    });
  });

  it('rejects consentWaiver=false with 400', async () => {
    const create: CreateMock = vi.fn();
    const app = buildApp(create);

    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ ...validBody, consentWaiver: false }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects disallowed origin with 403', async () => {
    const create: CreateMock = vi.fn();
    const app = buildApp(create);

    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify(validBody),
      }),
      env,
    );

    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects invalid email with 400', async () => {
    const create: CreateMock = vi.fn();
    const app = buildApp(create);

    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ ...validBody, email: 'not-an-email' }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects unsupported locale with 400', async () => {
    const create: CreateMock = vi.fn();
    const app = buildApp(create);

    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ ...validBody, locale: 'fr' }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
