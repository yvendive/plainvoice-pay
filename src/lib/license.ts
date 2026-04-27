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
export const LICENSE_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;

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
