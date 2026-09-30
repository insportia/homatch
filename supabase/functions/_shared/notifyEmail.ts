// NOTIFICATION EMAIL — the email leg of the one notification pipeline.
//
// Uses the canonical HOMATCH email provider (Resend, the adapter outreach
// already uses, from the verified auth.homatch.live sender). Every attempt is
// logged in notification_deliveries, keyed (notification_id, channel), so a
// retried cycle can never send the same notification twice. Without a
// configured provider the attempt is logged SKIPPED — never faked as sent.

import { ResendEmailAdapter } from './outreach_providers.ts';

type Sb = any;

export interface EmailContent { subject: string; html: string; text: string }

export async function sendNotificationEmail(sb: Sb, input: {
  userId: string; notificationId: string | null; eventKey?: string | null; source?: string; content: EmailContent;
}): Promise<{ status: 'SENT' | 'SKIPPED' | 'FAILED'; reason?: string }> {
  const log = async (status: string, extra: Record<string, unknown> = {}) => {
    const { error } = await sb.from('notification_deliveries').insert({
      notification_id: input.notificationId, user_id: input.userId, channel: 'EMAIL', status,
      source: input.source ?? 'meta_ads', event_key: input.eventKey ?? null, ...extra,
    });
    return !error || !String(error.message).includes('duplicate');
  };
  if (input.notificationId) {
    const { data: prior } = await sb.from('notification_deliveries').select('status')
      .eq('notification_id', input.notificationId).eq('channel', 'EMAIL').maybeSingle();
    if (prior) return { status: 'SKIPPED', reason: 'ALREADY_ATTEMPTED' };
  }
  const { data: user } = await sb.from('users').select('email').eq('id', input.userId).maybeSingle();
  const to = String(user?.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { await log('SKIPPED', { reason: 'NO_EMAIL' }); return { status: 'SKIPPED', reason: 'NO_EMAIL' }; }
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) { await log('SKIPPED', { reason: 'NO_PROVIDER' }); return { status: 'SKIPPED', reason: 'NO_PROVIDER' }; }
  const res = await new ResendEmailAdapter(key).send({
    to, subject: input.content.subject.slice(0, 200), html: input.content.html, text: input.content.text,
    from_name: 'HOMATCH',
  } as any);
  if (res.success) {
    await log('SENT', { provider: 'RESEND', provider_message_id: res.provider_message_id ?? null });
    return { status: 'SENT' };
  }
  await log('FAILED', { provider: 'RESEND', reason: String(res.error ?? 'SEND_FAILED').slice(0, 300) });
  return { status: 'FAILED', reason: res.error };
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** A plain, accessible, RTL-aware transactional email. */
export function renderNotificationEmail(o: {
  rtl: boolean; lang: string; title: string; body: string; whyLabel: string; why: string;
  analysisLabel: string; analysis: string | null; nextLabel: string; next: string | null;
  ctaLabel: string; ctaUrl: string; footer: string;
}): EmailContent {
  const dir = o.rtl ? 'rtl' : 'ltr';
  const align = o.rtl ? 'right' : 'left';
  const section = (label: string, text: string | null) => (text ? `<h2 style="font-size:14px;margin:20px 0 6px;color:#0C1119">${esc(label)}</h2><p style="margin:0;font-size:14px;line-height:1.55;color:#333">${esc(text)}</p>` : '');
  const html = `<!doctype html><html lang="${esc(o.lang)}" dir="${dir}"><body style="margin:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;text-align:${align}" dir="${dir}">
<tr><td style="background:#0C1119;color:#E8B04B;padding:16px 24px;border-radius:12px 12px 0 0;font-weight:bold;letter-spacing:.08em">HOMATCH</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 10px;color:#0C1119">${esc(o.title)}</h1>
<p style="margin:0;font-size:15px;line-height:1.55;color:#222">${esc(o.body)}</p>
${section(o.whyLabel, o.why)}${section(o.analysisLabel, o.analysis)}${section(o.nextLabel, o.next)}
<p style="margin:24px 0 0"><a href="${esc(o.ctaUrl)}" style="display:inline-block;background:#E8B04B;color:#161309;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">${esc(o.ctaLabel)}</a></p>
</td></tr><tr><td style="padding:0 24px 20px;font-size:12px;color:#777">${esc(o.footer)}</td></tr></table></td></tr></table></body></html>`;
  const text = [o.title, '', o.body, o.why ? `\n${o.whyLabel}: ${o.why}` : '', o.analysis ? `\n${o.analysisLabel}: ${o.analysis}` : '',
    o.next ? `\n${o.nextLabel}: ${o.next}` : '', `\n${o.ctaLabel}: ${o.ctaUrl}`, `\n\n${o.footer}`].join('\n');
  return { subject: o.title, html, text };
}
