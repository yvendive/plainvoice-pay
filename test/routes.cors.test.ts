/**
 * CORS env-scope test (issue #4).
 *
 * The wrangler.toml [env.production.vars] restricts ALLOWED_ORIGINS to
 * "https://plainvoice.de" only. These tests verify that the CORS middleware
 * correctly blocks localhost:3000 when given a production-like env, while
 * still allowing it under the default dev env.
 */
import { describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/app';
import type { StripeClient } from '../src/lib/stripe';
import type { LicenseRecord } from '../src/lib/license';

function buildApp() {
  const stripe: StripeClient = {
    checkout: { sessions: { create: async () => { throw new Error('not used'); } } },
    webhooks: { constructEventAsync: async () => { throw new Error('not used'); } },
  };
  return createApp({
    getStripe: () => stripe,
    sendLicenseEmail: vi.fn(async (_e: unknown, _r: LicenseRecord) => {}),
  });
}

/** Production env: ALLOWED_ORIGINS is narrowed to the live domain only. */
const productionEnv = { ...env, ALLOWED_ORIGINS: 'https://plainvoice.de' };

/** Dev env: both origins permitted (mirrors default wrangler.toml [vars]). */
const devEnv = { ...env, ALLOWED_ORIGINS: 'https://plainvoice.de,http://localhost:3000' };

describe('CORS — production env (ALLOWED_ORIGINS = plainvoice.de only)', () => {
  it('allows requests from https://plainvoice.de', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      productionEnv,
    );
    // 200 (unknown key) — NOT 403
    expect(res.status).toBe(200);
  });

  it('rejects requests from http://localhost:3000 with 403', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      productionEnv,
    );
    expect(res.status).toBe(403);
  });

  it('rejects OPTIONS preflight from http://localhost:3000 with 403', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/checkout', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        },
      }),
      productionEnv,
    );
    expect(res.status).toBe(403);
  });

  it('rejects requests from arbitrary unknown origins with 403', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      productionEnv,
    );
    expect(res.status).toBe(403);
  });
});

describe('CORS — dev env (ALLOWED_ORIGINS includes localhost)', () => {
  it('allows requests from http://localhost:3000', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      devEnv,
    );
    // 200 (unknown key) — NOT 403
    expect(res.status).toBe(200);
  });

  it('still allows requests from https://plainvoice.de', async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      devEnv,
    );
    expect(res.status).toBe(200);
  });
});
