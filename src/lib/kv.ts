import type { LicenseRecord } from './license';

export async function getLicense(kv: KVNamespace, key: string): Promise<LicenseRecord | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LicenseRecord;
  } catch {
    return null;
  }
}

export async function putLicense(kv: KVNamespace, record: LicenseRecord): Promise<void> {
  await kv.put(record.key, JSON.stringify(record));
}

export async function getPaymentLicense(
  kv: KVNamespace,
  paymentIntentId: string,
): Promise<string | null> {
  return kv.get(paymentIntentId);
}

export async function putPaymentLicense(
  kv: KVNamespace,
  paymentIntentId: string,
  licenseKey: string,
): Promise<void> {
  await kv.put(paymentIntentId, licenseKey);
}
