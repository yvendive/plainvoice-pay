/**
 * Per-route body size cap tests (issue #3).
 *
 * Verifies that oversize requests are rejected with 413 before any body
 * parsing or business-logic side effects occur.  Covers both the
 * Content-Length fast-path and the streaming (no Content-Length) path.
 */
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/app';
import type { StripeClient } from '../src/lib/stripe';
import type { LicenseRecord } from '../src/lib/license';
import { CHECKOUT_BODY_LIMIT, VERIFY_BODY_LIMIT, WEBHOOK_BODY_LIMIT } from '../src/lib/body-limit';

function buildApp(stripeMock?: Partial<StripeClient>) {
  const stripe: StripeClient = {
    checkout: {
      sessions: { create: vi.fn(async () => ({ id: 'cs_test', url: 'https://stripe.com/pay' })) },
    },
    webhooks: {
      constructEventAsync: vi.fn(async () => { throw new Error('not used'); }),
    },
    ...stripeMock,
  };
  return createApp({
    getStripe: () => stripe,
    sendLicenseEmail: vi.fn(async (_e: unknown, _r: LicenseRecord) => {}),
  });
}

/** Builds a Request with a body that is exactly `byteCount` bytes long. */
function oversizeRequest(path: string, byteCount: number): Request {
  const body = 'x'.repeat(byteCount);
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://plainvoice.de',
      // Content-Length is set automatically when body is a string
    },
    body,
  });
}

/**
 * Builds a Request with a streaming body (ReadableStream) so the runtime
 * does NOT add a Content-Length header — exercises the streaming cap path.
 */
function streamingOversizeRequest(path: string, byteCount: number): Request {
  const data = new TextEncoder().encode('x'.repeat(byteCount));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  return new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://plainvoice.de',
      // Deliberately NO Content-Length — ReadableStream body omits it
    },
    body: stream,
    // @ts-expect-error — duplex is required for streaming bodies in some runtimes
    duplex: 'half',
  });
}

// ---------------------------------------------------------------------------
// /api/verify — 256 B cap
// ---------------------------------------------------------------------------

describe('body-limit /api/verify (256 B)', () => {
  it('oversize body with Content-Length returns 413', async () => {
    const app = buildApp();
    const res = await app.fetch(
      oversizeRequest('/api/verify', VERIFY_BODY_LIMIT + 1),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('realistic-size verify body passes through (returns 200)', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      env,
    );
    // 200 + { valid: false } — key not in KV, but body passed the size cap
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
  });

  it('oversize streaming body (no Content-Length) returns 413', async () => {
    const app = buildApp();
    const res = await app.fetch(
      streamingOversizeRequest('/api/verify', VERIFY_BODY_LIMIT + 1),
      env,
    );
    expect(res.status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// /api/checkout — 4 KB cap
// ---------------------------------------------------------------------------

describe('body-limit /api/checkout (4 KB)', () => {
  it('oversize body with Content-Length returns 413', async () => {
    const app = buildApp();
    const res = await app.fetch(
      oversizeRequest('/api/checkout', CHECKOUT_BODY_LIMIT + 1),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('realistic-size checkout body passes through', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({
          email: 'buyer@example.com',
          locale: 'de',
          consentWaiver: true,
          consentTimestamp: '2026-04-27T10:00:00Z',
        }),
      }),
      env,
    );
    // 200 — body size within cap; Stripe mock returns a session URL
    expect(res.status).toBe(200);
  });

  it('oversize streaming body (no Content-Length) returns 413', async () => {
    const app = buildApp();
    const res = await app.fetch(
      streamingOversizeRequest('/api/checkout', CHECKOUT_BODY_LIMIT + 1),
      env,
    );
    expect(res.status).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// /api/webhook — 64 KB cap
// ---------------------------------------------------------------------------

describe('body-limit /api/webhook (64 KB)', () => {
  it('oversize body with Content-Length returns 413', async () => {
    const app = buildApp();
    const res = await app.fetch(
      oversizeRequest('/api/webhook', WEBHOOK_BODY_LIMIT + 1),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('realistic Stripe webhook body (small JSON) passes the size cap', async () => {
    // No valid Stripe signature → 400, but importantly NOT 413
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'bogus',
          Origin: 'https://plainvoice.de',
        },
        body: JSON.stringify({ type: 'checkout.session.completed', data: {} }),
      }),
      env,
    );
    // 400 (bad signature) — body passed the size cap
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(413);
  });

  it('oversize streaming body (no Content-Length) returns 413', async () => {
    const app = buildApp();
    const res = await app.fetch(
      streamingOversizeRequest('/api/webhook', WEBHOOK_BODY_LIMIT + 1),
      env,
    );
    expect(res.status).toBe(413);
  });
});
