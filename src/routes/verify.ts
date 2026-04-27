import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { corsFromEnv } from '../lib/cors';
import { getLicense } from '../lib/kv';
import { normalizeLicenseKey } from '../lib/license';

export function createVerifyRoute(): Hono<AppEnv> {
  const route = new Hono<AppEnv>();
  route.use('*', corsFromEnv);

  route.post('/', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ valid: false });
    }

    if (!raw || typeof raw !== 'object' || typeof (raw as { key?: unknown }).key !== 'string') {
      return c.json({ valid: false });
    }

    const key = normalizeLicenseKey((raw as { key: string }).key);
    if (!key) return c.json({ valid: false });

    const record = await getLicense(c.env.LICENSES, key);
    if (!record || record.revoked) {
      return c.json({ valid: false });
    }
    return c.json({ valid: true });
  });

  return route;
}
