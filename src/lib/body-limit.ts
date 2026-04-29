/**
 * Per-route request body size caps (issue #3).
 *
 * Buffer-first approach: the middleware fully reads and buffers the request
 * body before calling next(), returning 413 if the byte count exceeds the
 * cap.  The buffered body is re-exposed on c.req.raw so route handlers can
 * still call c.req.json() / c.req.text() normally.
 *
 * This is intentionally NOT Hono's built-in bodyLimit, which wraps the body
 * in a counting TransformStream.  That approach silently loses the 413 when a
 * route handler's try/catch swallows the stream error (as checkout and verify
 * both do).  Buffering in the middleware avoids the race entirely.
 *
 * Limits:
 *   /api/checkout  →  4 KB   (email + locale + consent fields)
 *   /api/verify    →  256 B  (single license-key field)
 *   /api/webhook   →  64 KB  (Stripe events are typically <8 KB; headroom)
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const CHECKOUT_BODY_LIMIT = 4 * 1024; // 4 KB
export const VERIFY_BODY_LIMIT = 256; // 256 B
export const WEBHOOK_BODY_LIMIT = 64 * 1024; // 64 KB

export function bodyLimit(maxBytes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    // Fast path: if Content-Length is present and already over the cap, reject
    // immediately without reading the body at all.
    const cl = c.req.raw.headers.get('content-length');
    if (cl !== null && parseInt(cl, 10) > maxBytes) {
      return c.text('Payload Too Large', 413);
    }

    const body = c.req.raw.body;
    if (!body) {
      return next();
    }

    // Buffer the entire body, counting bytes as we go.  Return 413 as soon as
    // the running total exceeds the cap so we don't waste memory on huge payloads.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return c.text('Payload Too Large', 413);
      }
      chunks.push(value);
    }

    // Re-expose the buffered body so route handlers can still call
    // c.req.json() / c.req.text() after this middleware ran.
    const allBytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      allBytes.set(chunk, offset);
      offset += chunk.length;
    }

    // @ts-expect-error — duplex:'half' is non-standard but required by some
    // runtimes for Request bodies that are not already fully buffered.
    c.req.raw = new Request(c.req.raw, { body: allBytes, duplex: 'half' });

    return next();
  };
}

export const checkoutBodyLimit = bodyLimit(CHECKOUT_BODY_LIMIT);
export const verifyBodyLimit = bodyLimit(VERIFY_BODY_LIMIT);
export const webhookBodyLimit = bodyLimit(WEBHOOK_BODY_LIMIT);
