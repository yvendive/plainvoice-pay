import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createApp } from '../src/app';
import type { StripeClient } from '../src/lib/stripe';
import type { LicenseRecord } from '../src/lib/license';

function buildApp() {
  const stripe: StripeClient = {
    checkout: {
      sessions: {
        create: async () => {
          throw new Error('not used in verify tests');
        },
      },
    },
    webhooks: {
      constructEventAsync: async () => {
        throw new Error('not used in verify tests');
      },
    },
  };
  return createApp({
    getStripe: () => stripe,
    sendLicenseEmail: vi.fn(async () => {}),
  });
}

async function clearKv() {
  const list = await env.LICENSES.list();
  for (const k of list.keys) {
    await env.LICENSES.delete(k.name);
  }
}

beforeEach(async () => {
  await clearKv();
});

async function seedLicense(
  record: Partial<LicenseRecord> & { key: string },
): Promise<LicenseRecord> {
  const full: LicenseRecord = {
    email: 'buyer@example.com',
    stripePaymentIntentId: 'pi_test',
    issuedAt: '2026-04-27T10:00:00Z',
    consentWaiver: true,
    consentTimestamp: '2026-04-27T09:59:00Z',
    locale: 'de',
    ...record,
  };
  await env.LICENSES.put(full.key, JSON.stringify(full));
  return full;
}

describe('POST /api/verify', () => {
  it('returns { valid: true } for a known key', async () => {
    await seedLicense({ key: 'aaaa1111bbbb2222cccc33' });
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
  });

  it('returns { valid: false } for an unknown key', async () => {
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'zzzz9999yyyy8888xxxx77' }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
  });

  it('returns { valid: false } for a revoked key', async () => {
    await seedLicense({ key: 'revokedkey1111111111aa', revoked: true });
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'revokedkey1111111111aa' }),
      }),
      env,
    );

    expect(await res.json()).toEqual({ valid: false });
  });

  it('trims and lowercases the key (forgiving paste)', async () => {
    await seedLicense({ key: 'paddedkey00000000000aa' });
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: '  PaddedKey00000000000aa  ' }),
      }),
      env,
    );

    expect(await res.json()).toEqual({ valid: true });
  });

  it('returns { valid: false } and 200 for missing/invalid body', async () => {
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: 'not-json',
      }),
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
  });

  it('rejects disallowed origin with 403', async () => {
    await seedLicense({ key: 'aaaa1111bbbb2222cccc33' });
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify({ key: 'aaaa1111bbbb2222cccc33' }),
      }),
      env,
    );

    expect(res.status).toBe(403);
  });

  it('does not leak record details on success', async () => {
    await seedLicense({ key: 'leaktest11111111111111', email: 'secret@example.com' });
    const app = buildApp();

    const res = await app.fetch(
      new Request('https://worker.test/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://plainvoice.de' },
        body: JSON.stringify({ key: 'leaktest11111111111111' }),
      }),
      env,
    );

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ valid: true });
    expect(body.email).toBeUndefined();
  });
});
