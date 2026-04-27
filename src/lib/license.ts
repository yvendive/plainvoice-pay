export type LicenseRecord = {
  key: string;
  email: string;
  stripePaymentIntentId: string;
  issuedAt: string;
  consentWaiver: true;
  consentTimestamp: string;
  locale: 'de' | 'en';
  revoked?: boolean;
};

export const LICENSE_KEY_LENGTH = 22;
export const LICENSE_KEY_PATTERN = /^[a-z0-9_-]{22}$/;

/**
 * Lowercased base64url to round-trip cleanly through the verify
 * endpoint's normalize step (trim + lowercase, forgiving paste from
 * email clients that capitalize first letters or auto-correct).
 *
 * Alphabet collapses from 64 → 38 chars (a-z, 0-9, '-', '_'),
 * giving ~115 bits of distinct outputs at length 22. The underlying
 * randomness is still 128 bits (16 random bytes); the collapse only
 * matters for collision resistance at scale, where birthday-paradox
 * half-collision needs ~2e17 keys — orders of magnitude beyond
 * any realistic license volume.
 */
export function generateLicenseKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes).toLowerCase();
}

export function normalizeLicenseKey(input: string): string {
  return input.trim().toLowerCase();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
