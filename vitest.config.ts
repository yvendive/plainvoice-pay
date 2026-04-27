import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            STRIPE_SECRET_KEY: 'sk_test_dummy',
            STRIPE_WEBHOOK_SECRET: 'whsec_dummy_test_secret_for_unit_tests_only',
            STRIPE_PRICE_ID: 'price_test_dummy',
            RESEND_API_KEY: 're_dummy',
            RESEND_FROM_ADDRESS: 'noreply@example.com',
            FRONTEND_URL: 'https://plainvoice.de',
            ALLOWED_ORIGINS: 'https://plainvoice.de,http://localhost:3000',
          },
          kvNamespaces: ['LICENSES', 'PAYMENTS'],
        },
      },
    },
  },
});
