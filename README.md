# plainvoice-pay

Cloudflare Worker backend for the Plainvoice Pro paywall. Turns one-time
Stripe Checkout payments into emailed license keys, and verifies those keys
on demand. The Plainvoice frontend (static site) calls this Worker; nothing
else does.

## Architecture

```
   browser (plainvoice.de, static)
        │  POST /api/checkout       ─────────►  Stripe Checkout
        │  POST /api/verify
        ▼
   ┌─────────────────────────┐                  ┌────────────────┐
   │  plainvoice-pay Worker  │  ◄── webhook ─── │     Stripe     │
   │  (Hono on CF Workers)   │                  └────────────────┘
   │                         │  email license   ┌────────────────┐
   │  KV: LICENSES, PAYMENTS │  ───────────►    │     Resend     │
   └─────────────────────────┘                  └────────────────┘
```

- `LICENSES` KV: `license_key → LicenseRecord` (JSON)
- `PAYMENTS` KV: `stripe_payment_intent_id → license_key` (idempotency)
- All Stripe / Resend credentials are Worker secrets, never committed.

## Local development

```bash
pnpm install
pnpm wrangler dev    # starts the Worker on http://127.0.0.1:8787
```

For local-secret testing, create a `.dev.vars` file (gitignored):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
RESEND_API_KEY=re_...
RESEND_FROM_ADDRESS=noreply@plain-cards.com
```

## Tests

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Tests run under `@cloudflare/vitest-pool-workers`, which provides real KV
namespaces in Miniflare. Stripe and Resend are mocked via dependency
injection (`createApp({ getStripe, sendLicenseEmail })`).

## Deploy bootstrap (Yves runs once)

The PR ships with placeholder KV namespace IDs and no Cloudflare secrets —
first deploy will fail until these six steps are done:

1. **Create LICENSES KV namespace**
   ```bash
   pnpm wrangler kv:namespace create LICENSES
   pnpm wrangler kv:namespace create LICENSES --preview
   ```
2. **Create PAYMENTS KV namespace**
   ```bash
   pnpm wrangler kv:namespace create PAYMENTS
   pnpm wrangler kv:namespace create PAYMENTS --preview
   ```
3. **Paste the four returned IDs into `wrangler.toml`** (the `id` and
   `preview_id` fields under each `[[kv_namespaces]]` block).
4. **Set Worker secrets** (one command per secret):
   ```bash
   pnpm wrangler secret put STRIPE_SECRET_KEY
   pnpm wrangler secret put STRIPE_WEBHOOK_SECRET
   pnpm wrangler secret put STRIPE_PRICE_ID
   pnpm wrangler secret put RESEND_API_KEY
   pnpm wrangler secret put RESEND_FROM_ADDRESS
   ```
5. **First deploy**
   ```bash
   pnpm wrangler deploy
   ```
   This prints the live Worker URL — give it to Stripe Dashboard →
   Developers → Webhooks to register the `checkout.session.completed`
   subscription, then paste the resulting signing secret back via
   `wrangler secret put STRIPE_WEBHOOK_SECRET`.
6. **Add `CLOUDFLARE_API_TOKEN` to GitHub Actions secrets** so the
   `deploy.yml` workflow can take over future deploys.

The CI workflow (`ci.yml`) runs lint + typecheck + test on every push and
PR with no secrets required. The deploy workflow only runs on `main` and
needs only `CLOUDFLARE_API_TOKEN`.

## Endpoints

### `POST /api/checkout`

Creates a Stripe Checkout Session.

**Request**

```json
{
  "email": "buyer@example.com",
  "locale": "de",
  "consentWaiver": true,
  "consentTimestamp": "2026-04-27T10:00:00Z"
}
```

**Response 200**

```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

**Errors**

- `400 invalid_json | invalid_body | invalid_email | invalid_locale | consent_required | invalid_consent_timestamp`
- `403 forbidden` (origin not in `ALLOWED_ORIGINS`)
- `502 stripe_error | session_url_missing`

### `POST /api/webhook`

Handles `checkout.session.completed`. Other event types: `200` and ignore.

- Signature verified via `stripe.webhooks.constructEventAsync` (the async
  variant; the sync variant uses Node `crypto` and breaks on Workers).
- Idempotent: a replay of the same `payment_intent` re-runs but performs
  no second KV write and no second email.
- Never echoes customer data in error responses.

**Response**: `200` (empty body) on success or ignored event,
`400` on missing/invalid signature.

### `POST /api/verify`

**Request**

```json
{ "key": "abc123def456ghi789jkl0" }
```

**Response 200**

```json
{ "valid": true }
```

or `{ "valid": false }`.

The endpoint trims whitespace and lowercases the input before lookup
(forgiving paste). It returns only the boolean — never the
`LicenseRecord` — and never `404`s, since that would distinguish
existence from revocation.

## Rate limiting

`/api/verify` should be rate-limited to **10 req/min per IP** via a
Cloudflare Rate Limiting rule configured in the Cloudflare dashboard
(Security → WAF → Rate Limiting). The rule lives at the dashboard level,
not in Worker code, so it is not represented in this repo.

## License

MIT. See `LICENSE`.
