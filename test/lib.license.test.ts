import { describe, it, expect } from 'vitest';
import { generateLicenseKey, normalizeLicenseKey, LICENSE_KEY_PATTERN } from '../src/lib/license';

describe('generateLicenseKey', () => {
  it('produces 22 URL-safe chars matching the regex', () => {
    for (let i = 0; i < 1000; i++) {
      const key = generateLicenseKey();
      expect(key).toMatch(LICENSE_KEY_PATTERN);
      expect(key.length).toBe(22);
    }
  });

  it('emits no collisions across 100k draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const key = generateLicenseKey();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(100_000);
  });
});

describe('normalizeLicenseKey', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeLicenseKey('  abc123  ')).toBe('abc123');
  });

  it('lowercases input for forgiving paste', () => {
    expect(normalizeLicenseKey('ABCdef')).toBe('abcdef');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeLicenseKey('   ')).toBe('');
  });
});
