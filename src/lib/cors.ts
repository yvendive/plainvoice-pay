import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const corsFromEnv: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = parseAllowed(c.env.ALLOWED_ORIGINS);

  if (origin && !allowed.includes(origin)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  if (c.req.method === 'OPTIONS') {
    if (origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type');
      c.header('Access-Control-Max-Age', '86400');
      c.header('Vary', 'Origin');
    }
    return c.body(null, 204);
  }

  await next();

  if (origin && allowed.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
  }
};

function parseAllowed(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
