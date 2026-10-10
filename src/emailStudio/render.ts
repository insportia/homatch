// HOMATCH EMAIL STUDIO — email-safe HTML.
//
// Table layout, inline styles, 600px max width, a single fluid column that reads on
// a phone without media queries (the one <style> rule is progressive enhancement).
// Every piece of text is escaped; every URL must be http(s) or it is dropped. Images
// are ONLY the listing's own photos, chosen by index — an index with no photo
// renders nothing, never a placeholder that looks like a property.
//
// Pure: the edge renders the real send with it, the editor renders the preview with
// it, and node:test checks both.

import { normalizeContent, type EmailBlock, type EmailContent } from './blocks.ts';
import { TEMPLATE_THEME, asEmailLang, isRtlLang, type EmailLang, type TemplateId, type TemplateTheme } from './templates.ts';

export interface PropertyEmailData {
  title: string | null;
  homatchId: number | null;
  transactionType: string | null; // SALE | RENT
  propertyType: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  price: number | null;
  currency: string | null;
  area: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  /** The listing's real photos, as absolute https URLs, in display order. */
  images: string[];
}

export interface RenderInput {
  content: EmailContent | unknown;
  templateId: TemplateId;
  lang: string;
  property: PropertyEmailData;
  /** Where the call to action points: the listing page. */
  listingUrl: string;
  /** "Nino via HOMATCH" — who the recipient is hearing from. */
  senderName: string;
  /** The signed unsubscribe link. Required for a real send. */
  unsubscribeUrl: string | null;
  /** Preview: a missing unsubscribe link becomes a visible placeholder. */
  preview?: boolean;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** How many photo blocks referenced a photo the listing does not have (dropped). */
  droppedImages: number;
}

interface ChromeCopy {
  forSale: string; forRent: string; area: string; rooms: string; bedrooms: string; bathrooms: string;
  floor: string; price: string; location: string; details: string; homatchId: string;
  reason: string; unsubscribe: string; unsubscribeLead: string; previewUnsubscribe: string;
  sentBy: string; contact: string; photoAlt: string; perMonth: string;
}

/** Fixed email chrome, per language. {{name}} is the sender. */
export const EMAIL_CHROME: Record<EmailLang, ChromeCopy> = {
  en: {
    forSale: 'For sale', forRent: 'For rent', area: 'Area', rooms: 'Rooms', bedrooms: 'Bedrooms', bathrooms: 'Bathrooms',
    floor: 'Floor', price: 'Price', location: 'Location', details: 'Property details', homatchId: 'HOMATCH ID',
    reason: 'You are receiving this email because you allowed property owners on HOMATCH to send you property offers by email.',
    unsubscribe: 'Unsubscribe', unsubscribeLead: 'Don’t want these emails?', previewUnsubscribe: 'Unsubscribe link (added to every email)',
    sentBy: 'Sent by {{name}} via HOMATCH', contact: 'Reply to this email to get in touch.', photoAlt: 'Property photo', perMonth: '/ month',
  },
  ka: {
    forSale: 'იყიდება', forRent: 'ქირავდება', area: 'ფართი', rooms: 'ოთახები', bedrooms: 'საძინებლები', bathrooms: 'სველი წერტილები',
    floor: 'სართული', price: 'ფასი', location: 'მდებარეობა', details: 'ქონების დეტალები', homatchId: 'HOMATCH ID',
    reason: 'ამ ელ-წერილს იღებთ, რადგან HOMATCH-ზე ნება დართეთ ქონების მფლობელებს, ელ-ფოსტით გამოგიგზავნონ ქონების შეთავაზებები.',
    unsubscribe: 'გამოწერის გაუქმება', unsubscribeLead: 'აღარ გსურთ ასეთი წერილები?', previewUnsubscribe: 'გამოწერის გაუქმების ბმული (ემატება ყველა წერილს)',
    sentBy: 'გამომგზავნი: {{name}}, HOMATCH-ის მეშვეობით', contact: 'დასაკავშირებლად უპასუხეთ ამ წერილს.', photoAlt: 'ქონების ფოტო', perMonth: '/ თვე',
  },
  ru: {
    forSale: 'Продажа', forRent: 'Аренда', area: 'Площадь', rooms: 'Комнаты', bedrooms: 'Спальни', bathrooms: 'Санузлы',
    floor: 'Этаж', price: 'Цена', location: 'Расположение', details: 'Параметры объекта', homatchId: 'HOMATCH ID',
    reason: 'Вы получили это письмо, потому что разрешили владельцам недвижимости на HOMATCH присылать вам предложения по электронной почте.',
    unsubscribe: 'Отписаться', unsubscribeLead: 'Не хотите получать такие письма?', previewUnsubscribe: 'Ссылка для отписки (добавляется в каждое письмо)',
    sentBy: 'Отправитель: {{name}} через HOMATCH', contact: 'Чтобы связаться, ответьте на это письмо.', photoAlt: 'Фото объекта', perMonth: '/ мес.',
  },
  tr: {
    forSale: 'Satılık', forRent: 'Kiralık', area: 'Alan', rooms: 'Oda', bedrooms: 'Yatak odası', bathrooms: 'Banyo',
    floor: 'Kat', price: 'Fiyat', location: 'Konum', details: 'Mülk ayrıntıları', homatchId: 'HOMATCH ID',
    reason: 'Bu e-postayı, HOMATCH’teki mülk sahiplerinin size e-postayla mülk teklifleri göndermesine izin verdiğiniz için alıyorsunuz.',
    unsubscribe: 'Abonelikten çık', unsubscribeLead: 'Bu e-postaları almak istemiyor musunuz?', previewUnsubscribe: 'Abonelikten çıkma bağlantısı (her e-postaya eklenir)',
    sentBy: '{{name}} tarafından HOMATCH üzerinden gönderildi', contact: 'İletişime geçmek için bu e-postayı yanıtlayın.', photoAlt: 'Mülk fotoğrafı', perMonth: '/ ay',
  },
  ar: {
    forSale: 'للبيع', forRent: 'للإيجار', area: 'المساحة', rooms: 'الغرف', bedrooms: 'غرف النوم', bathrooms: 'الحمّامات',
    floor: 'الطابق', price: 'السعر', location: 'الموقع', details: 'تفاصيل العقار', homatchId: 'رقم HOMATCH',
    reason: 'تتلقى هذه الرسالة لأنك سمحت لمالكي العقارات على HOMATCH بإرسال عروض عقارية إليك عبر البريد الإلكتروني.',
    unsubscribe: 'إلغاء الاشتراك', unsubscribeLead: 'لا ترغب في تلقي هذه الرسائل؟', previewUnsubscribe: 'رابط إلغاء الاشتراك (يُضاف إلى كل رسالة)',
    sentBy: 'أرسلها {{name}} عبر HOMATCH', contact: 'للتواصل، ردّ على هذه الرسالة.', photoAlt: 'صورة العقار', perMonth: '/ شهريًا',
  },
  he: {
    forSale: 'למכירה', forRent: 'להשכרה', area: 'שטח', rooms: 'חדרים', bedrooms: 'חדרי שינה', bathrooms: 'חדרי רחצה',
    floor: 'קומה', price: 'מחיר', location: 'מיקום', details: 'פרטי הנכס', homatchId: 'מזהה HOMATCH',
    reason: 'קיבלת הודעה זו כי אישרת לבעלי נכסים ב־HOMATCH לשלוח לך הצעות נכסים בדוא״ל.',
    unsubscribe: 'הסרה מרשימת התפוצה', unsubscribeLead: 'לא רוצה לקבל הודעות כאלה?', previewUnsubscribe: 'קישור להסרה (מתווסף לכל הודעה)',
    sentBy: 'נשלח על ידי {{name}} דרך HOMATCH', contact: 'כדי ליצור קשר, השיבו להודעה זו.', photoAlt: 'תמונת הנכס', perMonth: '/ חודש',
  },
};

const LOCALE: Record<EmailLang, string> = { en: 'en-US', ka: 'ka-GE', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar', he: 'he-IL' };

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An http(s) URL, attribute-escaped — or null. */
export function safeUrl(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s)) return null;
  return escapeHtml(s);
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

function formatNumber(n: number, lang: EmailLang): string {
  try { return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 1 }).format(n); } catch { return String(n); }
}

export function formatPrice(price: number | null, currency: string | null, lang: EmailLang): string | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const cur = (currency || '').toUpperCase();
  try {
    if (/^[A-Z]{3}$/.test(cur)) {
      return new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(price);
    }
  } catch { /* fall through */ }
  return `${formatNumber(price, lang)}${cur ? ` ${cur}` : ''}`;
}

function paragraphs(text: string, style: string): string {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

interface Ctx {
  theme: TemplateTheme;
  lang: EmailLang;
  rtl: boolean;
  align: 'left' | 'right';
  chrome: ChromeCopy;
  property: PropertyEmailData;
  images: string[];
  listingUrl: string | null;
  font: string;
  dropped: number;
}

function row(inner: string, padding = '0 32px'): string {
  return `<tr><td class="es-pad" style="padding:${padding};">${inner}</td></tr>`;
}

function imageTag(url: string, alt: string, radius: number, width: number): string {
  return `<img src="${url}" alt="${escapeHtml(alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${radius}px;">`;
}

function locationLine(p: PropertyEmailData): string | null {
  const parts = [p.address, p.district, p.city].map((s) => (s ?? '').trim()).filter(Boolean);
  const unique = parts.filter((s, i) => parts.indexOf(s) === i);
  return unique.length ? unique.join(', ') : null;
}

function specRows(ctx: Ctx): Array<[string, string]> {
  const p = ctx.property;
  const c = ctx.chrome;
  const out: Array<[string, string]> = [];
  if (p.area && p.area > 0) out.push([c.area, `${formatNumber(p.area, ctx.lang)} m²`]);
  if (p.rooms && p.rooms > 0) out.push([c.rooms, formatNumber(p.rooms, ctx.lang)]);
  if (p.bedrooms && p.bedrooms > 0) out.push([c.bedrooms, formatNumber(p.bedrooms, ctx.lang)]);
  if (p.bathrooms && p.bathrooms > 0) out.push([c.bathrooms, formatNumber(p.bathrooms, ctx.lang)]);
  if (p.floor !== null && p.floor !== undefined && Number.isFinite(p.floor)) {
    out.push([c.floor, p.totalFloors ? `${formatNumber(p.floor, ctx.lang)} / ${formatNumber(p.totalFloors, ctx.lang)}` : formatNumber(p.floor, ctx.lang)]);
  }
  return out;
}

function renderBlock(block: EmailBlock, ctx: Ctx, unsubscribe: { url: string | null; preview: boolean }, senderName: string): { html: string; text: string } {
  const t = ctx.theme;
  const p = ctx.property;
  const base = `margin:0;font-family:${ctx.font};color:${t.ink};text-align:${ctx.align};`;
  switch (block.type) {
    case 'logo': {
      const html = `<tr><td style="background:${t.headerBg};padding:20px 32px;text-align:${ctx.align};">`
        + `<span style="font-family:${ctx.font};font-size:18px;font-weight:800;letter-spacing:0.18em;color:${t.headerInk};">HOMATCH</span></td></tr>`;
      return { html, text: 'HOMATCH' };
    }
    case 'headline': {
      const text = (block.text ?? '').trim();
      if (!text) return { html: '', text: '' };
      return {
        html: row(`<h1 style="${base}font-size:${t.headlineSize}px;line-height:1.25;font-weight:700;padding-top:24px;">${escapeHtml(text)}</h1>`),
        text,
      };
    }
    case 'text':
    case 'contact': {
      const text = (block.text ?? '').trim() || (block.type === 'contact' ? ctx.chrome.contact : '');
      if (!text) return { html: '', text: '' };
      const color = block.type === 'contact' ? t.muted : t.ink;
      return {
        html: row(paragraphs(text, `${base}color:${color};font-size:16px;line-height:1.6;padding-top:14px;`)),
        text,
      };
    }
    case 'hero': {
      const url = block.image !== undefined ? ctx.images[block.image] : undefined;
      if (!url) return { html: '', text: '' };
      const pad = t.heroRadius === 0 ? '0' : '24px 32px 0';
      return { html: row(imageTag(url, p.title || ctx.chrome.photoAlt, t.heroRadius, t.heroRadius === 0 ? 600 : 536), pad), text: '' };
    }
    case 'gallery': {
      const urls = (block.images ?? []).map((i) => ctx.images[i]).filter((u): u is string => Boolean(u));
      if (!urls.length) return { html: '', text: '' };
      const cells = urls.map((u) => `<td class="es-col" width="${Math.floor(100 / Math.min(urls.length, 2))}%" style="padding:6px;vertical-align:top;">${imageTag(u, ctx.chrome.photoAlt, 6, 260)}</td>`);
      const rows: string[] = [];
      for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells.slice(i, i + 2).join('')}</tr>`);
      return {
        html: row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">${rows.join('')}</table>`, '0 26px'),
        text: '',
      };
    }
    case 'price': {
      const price = formatPrice(p.price, p.currency, ctx.lang);
      if (!price) return { html: '', text: '' };
      const rent = (p.transactionType ?? '').toUpperCase() === 'RENT';
      const label = rent ? ctx.chrome.forRent : (p.transactionType ? ctx.chrome.forSale : ctx.chrome.price);
      const value = rent ? `${price} ${ctx.chrome.perMonth}` : price;
      return {
        html: row(`<p style="${base}padding-top:20px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${t.accent};font-weight:700;">${escapeHtml(label)}</p>`
          + `<p style="${base}font-size:24px;font-weight:700;padding-top:4px;">${escapeHtml(value)}</p>`),
        text: `${label}: ${value}`,
      };
    }
    case 'specs': {
      const specs = specRows(ctx);
      if (!specs.length) return { html: '', text: '' };
      const cells = specs.map(([k, v]) => `<td class="es-col" style="padding:10px 8px;border-top:1px solid ${t.hairline};vertical-align:top;text-align:${ctx.align};">`
        + `<span style="display:block;font-family:${ctx.font};font-size:12px;color:${t.muted};">${escapeHtml(k)}</span>`
        + `<span style="display:block;font-family:${ctx.font};font-size:16px;font-weight:700;color:${t.ink};padding-top:2px;">${escapeHtml(v)}</span></td>`);
      const rows: string[] = [];
      for (let i = 0; i < cells.length; i += 3) rows.push(`<tr>${cells.slice(i, i + 3).join('')}</tr>`);
      return {
        html: row(`<p style="${base}padding-top:22px;font-size:13px;font-weight:700;">${escapeHtml(ctx.chrome.details)}</p>`
          + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${rows.join('')}</table>`),
        text: specs.map(([k, v]) => `${k}: ${v}`).join('\n'),
      };
    }
    case 'location': {
      const loc = locationLine(p);
      if (!loc) return { html: '', text: '' };
      return {
        html: row(`<p style="${base}padding-top:18px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${t.accent};font-weight:700;">${escapeHtml(ctx.chrome.location)}</p>`
          + `<p style="${base}font-size:16px;padding-top:4px;">${escapeHtml(loc)}</p>`),
        text: `${ctx.chrome.location}: ${loc}`,
      };
    }
    case 'cta': {
      const label = (block.text ?? '').trim();
      if (!label || !ctx.listingUrl) return { html: '', text: '' };
      const btn = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${ctx.align}" style="margin-top:26px;"><tr>`
        + `<td style="border-radius:10px;background:${t.ctaBg};">`
        + `<a href="${ctx.listingUrl}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${ctx.font};font-size:16px;font-weight:700;color:${t.ctaInk};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>`
        + `</td></tr></table>`;
      return { html: row(btn), text: `${label}: ${ctx.listingUrl.replace(/&amp;/g, '&')}` };
    }
    case 'divider':
      return { html: row(`<div style="border-top:1px solid ${t.hairline};margin-top:24px;line-height:1px;font-size:1px;">&nbsp;</div>`), text: '' };
    case 'footer': {
      const sent = fill(ctx.chrome.sentBy, { name: senderName });
      const idLine = p.homatchId ? ` · ${ctx.chrome.homatchId} ${p.homatchId}` : '';
      return {
        html: row(`<div style="border-top:1px solid ${t.hairline};margin-top:32px;"></div>`
          + `<p style="${base}color:${t.muted};font-size:12px;line-height:1.6;padding-top:16px;">${escapeHtml(sent)}${escapeHtml(idLine)}</p>`
          + `<p style="${base}color:${t.muted};font-size:12px;line-height:1.6;padding-top:6px;">${escapeHtml(ctx.chrome.reason)}</p>`),
        text: `${sent}${idLine}\n${ctx.chrome.reason}`,
      };
    }
    case 'unsubscribe': {
      const url = safeUrl(unsubscribe.url);
      if (url) {
        return {
          html: row(`<p style="${base}color:${t.muted};font-size:12px;line-height:1.6;padding:8px 0 28px;">${escapeHtml(ctx.chrome.unsubscribeLead)} `
            + `<a href="${url}" target="_blank" rel="noopener" style="color:${t.muted};text-decoration:underline;">${escapeHtml(ctx.chrome.unsubscribe)}</a></p>`),
          text: `${ctx.chrome.unsubscribeLead} ${ctx.chrome.unsubscribe}: ${String(unsubscribe.url)}`,
        };
      }
      return {
        html: row(`<p style="${base}color:${t.muted};font-size:12px;line-height:1.6;padding:8px 0 28px;">${escapeHtml(ctx.chrome.unsubscribeLead)} `
          + `<span style="text-decoration:underline;">${escapeHtml(ctx.chrome.unsubscribe)}</span> <span style="font-style:italic;">(${escapeHtml(ctx.chrome.previewUnsubscribe)})</span></p>`),
        text: `${ctx.chrome.unsubscribeLead} ${ctx.chrome.unsubscribe}`,
      };
    }
    default:
      return { html: '', text: '' };
  }
}

/**
 * The email. Throws when a real send (preview false) has no valid unsubscribe link:
 * there is no way to produce a campaign email without one.
 */
export function renderEmail(input: RenderInput): RenderedEmail {
  const lang = asEmailLang(input.lang);
  const preview = input.preview === true;
  if (!preview && !safeUrl(input.unsubscribeUrl)) {
    throw new Error('UNSUBSCRIBE_URL_REQUIRED');
  }
  const images = (input.property.images ?? []).map((u) => safeUrl(u)).filter((u): u is string => Boolean(u));
  const content = normalizeContent(input.content, images.length);
  const theme = TEMPLATE_THEME[input.templateId] ?? TEMPLATE_THEME.PROPERTY_INTRODUCTION;
  const rtl = isRtlLang(lang);
  const ctx: Ctx = {
    theme, lang, rtl, align: rtl ? 'right' : 'left', chrome: EMAIL_CHROME[lang], property: input.property,
    images, listingUrl: safeUrl(input.listingUrl),
    font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans','Noto Sans Georgian','Noto Sans Hebrew','Noto Sans Arabic',Arial,sans-serif",
    dropped: 0,
  };
  // Count photo indexes the raw content asked for that the listing cannot supply.
  const rawBlocks = (input.content && typeof input.content === 'object' && Array.isArray((input.content as EmailContent).blocks))
    ? (input.content as EmailContent).blocks : [];
  for (const b of rawBlocks) {
    if (b && b.type === 'hero' && typeof b.image === 'number' && !images[b.image]) ctx.dropped++;
    if (b && b.type === 'gallery' && Array.isArray(b.images)) ctx.dropped += b.images.filter((i) => typeof i === 'number' && !images[i]).length;
  }
  const dropped = ctx.dropped;

  const parts = content.blocks.map((b) => renderBlock(b, ctx, { url: input.unsubscribeUrl, preview }, input.senderName));
  const subject = content.subject || (input.property.title ?? 'HOMATCH');
  const preheader = content.preheader;
  const dir = rtl ? 'rtl' : 'ltr';

  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:480px){.es-pad{padding-left:20px!important;padding-right:20px!important}.es-col{display:block!important;width:100%!important;box-sizing:border-box}}</style>
</head>
<body style="margin:0;padding:0;background:${theme.canvas};-webkit-text-size-adjust:100%;" dir="${dir}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.canvas};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="max-width:600px;width:100%;background:${theme.surface};border-radius:14px;overflow:hidden;">
${parts.map((p) => p.html).filter(Boolean).join('\n')}
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [subject, '', ...parts.map((p) => p.text).filter(Boolean)].join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject, preheader, html, text, droppedImages: dropped };
}
