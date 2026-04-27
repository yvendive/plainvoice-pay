import { Resend } from 'resend';
import type { Bindings } from '../types';
import type { LicenseRecord } from './license';

export type ResendEnv = Pick<Bindings, 'RESEND_API_KEY' | 'RESEND_FROM_ADDRESS' | 'FRONTEND_URL'>;

export type SendLicenseEmail = (env: ResendEnv, record: LicenseRecord) => Promise<void>;

export const sendLicenseEmail: SendLicenseEmail = async (env, record) => {
  const resend = new Resend(env.RESEND_API_KEY);
  const { subject, text, html } = buildEmail(record, env.FRONTEND_URL);
  await resend.emails.send({
    from: env.RESEND_FROM_ADDRESS,
    to: record.email,
    subject,
    text,
    html,
  });
};

export function buildEmail(record: LicenseRecord, frontendUrl: string) {
  return record.locale === 'de' ? buildDe(record, frontendUrl) : buildEn(record, frontendUrl);
}

function buildDe(record: LicenseRecord, frontendUrl: string) {
  const subject = 'Ihr Plainvoice Pro Lizenzschlüssel';
  const unlockUrl = `${frontendUrl}/de/unlock`;
  const text = `Hallo,

vielen Dank für Ihren Kauf von Plainvoice Pro.

Ihr Lizenzschlüssel:

  ${record.key}

So aktivieren Sie Pro:
1. Öffnen Sie ${unlockUrl}
2. Fügen Sie den Schlüssel ein
3. Klicken Sie auf "Aktivieren"

Der Schlüssel ist unbefristet gültig und an dieses Browser-Profil gebunden.
Bewahren Sie die E-Mail auf — bei Browserwechsel oder neuem Gerät benötigen Sie ihn erneut.

Eine Rechnung erhalten Sie separat von Stripe.

Bei Fragen: info@plain-cards.com

— YS Development B.V.
`;
  const html = baseHtml({
    intro: 'vielen Dank für Ihren Kauf von Plainvoice Pro.',
    keyLabel: 'Ihr Lizenzschlüssel:',
    key: record.key,
    steps: [
      'Öffnen Sie die Aktivierungsseite',
      'Fügen Sie den Schlüssel ein',
      'Klicken Sie auf „Aktivieren"',
    ],
    cta: 'Pro jetzt aktivieren',
    ctaUrl: unlockUrl,
    footer:
      'Eine Rechnung erhalten Sie separat von Stripe. Fragen? info@plain-cards.com — YS Development B.V.',
    greeting: 'Hallo,',
  });
  return { subject, text, html };
}

function buildEn(record: LicenseRecord, frontendUrl: string) {
  const subject = 'Your Plainvoice Pro license key';
  const unlockUrl = `${frontendUrl}/en/unlock`;
  const text = `Hello,

thank you for purchasing Plainvoice Pro.

Your license key:

  ${record.key}

How to activate Pro:
1. Open ${unlockUrl}
2. Paste the key
3. Click "Activate"

The key is valid indefinitely and bound to this browser profile.
Keep this email — if you switch browsers or devices, you'll need it again.

Your invoice will arrive separately from Stripe.

Questions? info@plain-cards.com

— YS Development B.V.
`;
  const html = baseHtml({
    intro: 'thank you for purchasing Plainvoice Pro.',
    keyLabel: 'Your license key:',
    key: record.key,
    steps: ['Open the activation page', 'Paste the key', 'Click "Activate"'],
    cta: 'Activate Pro',
    ctaUrl: unlockUrl,
    footer:
      'Your invoice will arrive separately from Stripe. Questions? info@plain-cards.com — YS Development B.V.',
    greeting: 'Hello,',
  });
  return { subject, text, html };
}

type HtmlOpts = {
  greeting: string;
  intro: string;
  keyLabel: string;
  key: string;
  steps: string[];
  cta: string;
  ctaUrl: string;
  footer: string;
};

function baseHtml(o: HtmlOpts): string {
  const stepsHtml = o.steps.map((s) => `<li style="margin: 4px 0;">${escapeHtml(s)}</li>`).join('');
  return `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
<p>${escapeHtml(o.greeting)}</p>
<p>${escapeHtml(o.intro)}</p>
<p style="margin-top: 16px; margin-bottom: 4px;">${escapeHtml(o.keyLabel)}</p>
<pre style="background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 6px; padding: 12px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; user-select: all;">${escapeHtml(o.key)}</pre>
<ol style="padding-left: 20px;">${stepsHtml}</ol>
<p style="margin-top: 16px;"><a href="${escapeAttr(o.ctaUrl)}" style="display: inline-block; padding: 10px 16px; background: #111; color: #fff; text-decoration: none; border-radius: 6px;">${escapeHtml(o.cta)}</a></p>
<hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
<p style="font-size: 12px; color: #555;">${escapeHtml(o.footer)}</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
