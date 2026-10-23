// THE CAMPAIGN EMAIL — one template for what is sent (outreach-send) and what is previewed
// (Email Marketing → campaign preview), so the preview is the email.
//
// Built for real mail clients, not browsers: a table layout with inline styles only (Gmail
// strips <style> in many contexts; Outlook renders with Word), no images, no web fonts, no
// flex/grid, a bulletproof table button, a hidden preheader, and dir="rtl" for Arabic and
// Hebrew. Owner text is escaped; owner HTML (html_body) is placed as written, as before.

import { readDesignMarker } from './designer/render.ts';

export type CampaignEmailLang = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';

export interface CampaignEmailInput {
  subject: string;
  /** Plain-text body: blank lines are paragraphs, single newlines are line breaks. */
  bodyText?: string | null;
  /** The owner's own HTML, used instead of bodyText when present. */
  bodyHtml?: string | null;
  senderName?: string | null;
  lang?: string | null;
  preheader?: string | null;
  cta?: { label: string; url: string } | null;
  /** Required on every marketing email; a test may point at the owner's own settings. */
  unsubscribeUrl: string;
}

const FOOTER: Record<CampaignEmailLang, { sentBy: (n: string) => string; why: string; unsubscribe: string }> = {
  en: { sentBy: (n) => `Sent by ${n} via HOMATCH`, why: 'You are receiving this email because you agreed to hear from this sender.', unsubscribe: 'Unsubscribe' },
  ka: { sentBy: (n) => `გამომგზავნი: ${n} · HOMATCH`, why: 'ამ წერილს იღებთ, რადგან დათანხმდით ამ გამომგზავნისგან შეტყობინებების მიღებას.', unsubscribe: 'გამოწერის გაუქმება' },
  ru: { sentBy: (n) => `Отправитель: ${n} · HOMATCH`, why: 'Вы получили это письмо, потому что согласились получать сообщения от этого отправителя.', unsubscribe: 'Отписаться' },
  tr: { sentBy: (n) => `Gönderen: ${n} · HOMATCH`, why: 'Bu e-postayı, bu göndericiden ileti almayı kabul ettiğiniz için alıyorsunuz.', unsubscribe: 'Abonelikten çık' },
  ar: { sentBy: (n) => `المرسل: ${n} · HOMATCH`, why: 'تتلقى هذه الرسالة لأنك وافقت على تلقي الرسائل من هذا المرسل.', unsubscribe: 'إلغاء الاشتراك' },
  he: { sentBy: (n) => `השולח: ${n} · HOMATCH`, why: 'קיבלת הודעה זו מפני שהסכמת לקבל הודעות משולח זה.', unsubscribe: 'הסרה מרשימת התפוצה' },
};

const INK = '#0C1119';
const GOLD = '#E8A33D';
const CANVAS = '#F6F3EE';
const TEXT = '#1F2430';
const MUTED = '#6B7280';
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans Georgian', 'Noto Sans Arabic', 'Noto Sans Hebrew', sans-serif";

export function asCampaignLang(lang: string | null | undefined): CampaignEmailLang {
  const l = String(lang ?? '').slice(0, 2).toLowerCase();
  return (['en', 'ka', 'ru', 'tr', 'ar', 'he'] as const).includes(l as CampaignEmailLang) ? (l as CampaignEmailLang) : 'en';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only http(s) and mailto links reach a href; anything else becomes "#". */
export function safeHref(url: string | null | undefined): string {
  const u = String(url ?? '').trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? escapeHtml(u) : '#';
}

function paragraphs(text: string, align: string): string {
  return text.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).filter((p) => p.trim()).map((p) =>
    `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.65;color:${TEXT};text-align:${align};">${escapeHtml(p).replace(/\n/g, '<br />')}</p>`,
  ).join('\n');
}

export function renderCampaignEmail(input: CampaignEmailInput): { html: string; text: string } {
  const lang = asCampaignLang(input.lang);
  const rtl = lang === 'ar' || lang === 'he';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const f = FOOTER[lang];
  const sender = (input.senderName ?? '').trim() || 'HOMATCH';
  /* A designed body (Email Studio designer) links its own unsubscribe block to {{unsubscribe_url}}. */
  if (input.bodyHtml) input = { ...input, bodyHtml: input.bodyHtml.replace(/\{\{\s*unsubscribe_url\s*\}\}/g, safeHref(input.unsubscribeUrl)) };
  const designed = readDesignMarker(input.bodyHtml);
  if (designed) return renderDesigned(input, designed, { lang, dir, align, f, sender });
  const body = input.bodyHtml && input.bodyHtml.trim()
    ? `<div style="font-family:${FONT};font-size:16px;line-height:1.65;color:${TEXT};text-align:${align};">${input.bodyHtml}</div>`
    : paragraphs(input.bodyText ?? '', align);
  const preheader = (input.preheader ?? (input.bodyText ?? '').replace(/\s+/g, ' ').slice(0, 110)).trim();
  const cta = input.cta && input.cta.label.trim() && safeHref(input.cta.url) !== '#'
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px 0;" align="${align}"><tr>
        <td bgcolor="${GOLD}" style="border-radius:10px;">
          <a href="${safeHref(input.cta.url)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};text-decoration:none;border-radius:10px;">${escapeHtml(input.cta.label)}</a>
        </td></tr></table>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="background-color:${CANVAS};" dir="${dir}">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td bgcolor="${INK}" style="background-color:${INK};border-radius:16px 16px 0 0;padding:22px 32px;text-align:${align};">
        <span style="font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:3px;color:${GOLD};">HOMATCH</span>
        <div style="height:3px;width:40px;background-color:${GOLD};border-radius:2px;margin-top:10px;line-height:3px;font-size:0;">&nbsp;</div>
      </td></tr>
      <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:32px 32px 16px 32px;border-left:1px solid #ECE7DE;border-right:1px solid #ECE7DE;">
        <h1 style="margin:0 0 18px 0;font-family:${FONT};font-size:22px;line-height:1.35;font-weight:700;color:${INK};text-align:${align};">${escapeHtml(input.subject)}</h1>
        ${body}
        ${cta}
      </td></tr>
      <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:8px 32px 28px 32px;border-left:1px solid #ECE7DE;border-right:1px solid #ECE7DE;border-bottom:1px solid #ECE7DE;border-radius:0 0 16px 16px;">
        <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${TEXT};font-weight:600;text-align:${align};">${escapeHtml(sender)}</p>
      </td></tr>
      <tr><td style="padding:20px 32px 8px 32px;text-align:${align};">
        <p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(f.sentBy(sender))}</p>
        <p style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(f.why)}</p>
        <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;"><a href="${safeHref(input.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(f.unsubscribe)}</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const textBody = input.bodyText && input.bodyText.trim()
    ? input.bodyText.trim()
    : String(input.bodyHtml ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const text = [
    input.subject, '', textBody,
    input.cta && safeHref(input.cta.url) !== '#' ? `\n${input.cta.label}: ${input.cta.url}` : '',
    '', '—', f.sentBy(sender), f.why, `${f.unsubscribe}: ${input.unsubscribeUrl}`,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}

/*
 * A DESIGNED EMAIL (Email Studio designer, src/emailMarketing/designer/render.ts): the designer
 * owns the card — its canvas colour, width and every block — and this shell adds only what every
 * marketing email must carry and the sender may not remove: who sent it, why the reader gets it,
 * and the one-click unsubscribe link. The mobile media query moves from the body into <head>.
 */
function renderDesigned(
  input: CampaignEmailInput,
  d: { canvas: string; card: string; width: number; radius: number },
  ctx: { lang: CampaignEmailLang; dir: string; align: string; f: (typeof FOOTER)[CampaignEmailLang]; sender: string },
): { html: string; text: string } {
  const { lang, dir, align, f, sender } = ctx;
  let body = String(input.bodyHtml ?? '');
  const styles: string[] = [];
  body = body.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_m, css: string) => { styles.push(css.replace(/<\/?[a-z][^>]*>/gi, '')); return ''; });
  const preheader = (input.preheader ?? '').trim();
  const html = `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(input.subject)}</title>
${styles.length ? `<style type="text/css">${styles.join('\n')}</style>` : ''}
</head>
<body style="margin:0;padding:0;background-color:${d.canvas};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${d.canvas}" style="background-color:${d.canvas};" dir="${dir}">
  <tr><td align="center" style="padding:24px 10px;">
    <table role="presentation" class="hm-body" width="${d.width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${d.width}px;">
      <tr><td bgcolor="${d.card}" style="background-color:${d.card};border-radius:${d.radius}px;overflow:hidden;" dir="${dir}">
${body.trim()}
      </td></tr>
      <tr><td style="padding:18px 24px 6px 24px;text-align:${align};">
        <p style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(f.sentBy(sender))}</p>
        <p style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(f.why)}</p>
        <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;"><a href="${safeHref(input.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(f.unsubscribe)}</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const bodyText = (input.bodyText ?? '').replace(/\{\{\s*unsubscribe_url\s*\}\}/g, input.unsubscribeUrl).trim();
  const text = [input.subject, '', bodyText, '', '—', f.sentBy(sender), f.why, `${f.unsubscribe}: ${input.unsubscribeUrl}`]
    .join('\n').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}
