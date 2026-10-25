// EMAIL DESIGNER — document → email-client HTML. Owner brief §5.
//
// One renderer for the designer canvas preview, the desktop/mobile preview, the test send and the
// campaign the server stores: the server calls renderDesignBody(normalizeDoc(input)), so what was
// previewed is what is sent and nothing the browser wrote reaches a recipient as markup.
//
// Mail-client rules: one self-contained <table> (so both send paths — per-recipient and Resend
// broadcast — can wrap it), inline styles only, bulletproof table buttons, explicit image widths
// with max-width:100%, no web fonts, no flex/grid, no <style> dependence. A single optional <style>
// carries the mobile media query (stacking columns, hiding blocks); clients that strip it still
// get a readable single-width email.
//
// The marker comment lets campaignTemplate.ts give a designed email the designer's own canvas and
// width while keeping the mandatory compliance footer (sender, reason, unsubscribe) it adds to
// every marketing email.

import {
  type Block, type ButtonBlock, type ColumnsBlock, type EmailDoc, FONT_STACKS, type IconGlyph, type LeafBlock, normalizeDoc, type Pad,
  type SectionBlock, type Theme, walkBlocks,
} from './document.ts';
import { emailHtmlToText } from './emailHtml.ts';
import { richToEmailHtml, richToText } from './richText.ts';

export const DESIGN_MARKER = '<!--homatch-designer:v1';

/* Long words (a URL, a long Georgian compound) wrap inside their block instead of widening it. */
const WRAP = 'word-break:break-word;overflow-wrap:break-word;';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attrUrl = (u: string) => esc(u);
const padCss = (p?: Pad) => (p ? `${p.t}px ${p.r}px ${p.b}px ${p.l}px` : '8px 32px');

/** **bold**, *italic*, [label](https://…), newlines → <br>. Everything else is escaped text. */
export function inlineMarkup(text: string, linkColor: string): string {
  const out: string[] = [];
  const re = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    out.push(styleRuns(text.slice(last, m.index)));
    const href = m[2];
    const ok = /^https:\/\/[^\s<>"']+$/i.test(href) || /^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(href) || /^\{\{\s*unsubscribe_url\s*\}\}$/.test(href);
    out.push(ok ? `<a href="${attrUrl(href)}" target="_blank" style="color:${linkColor};text-decoration:underline;">${styleRuns(m[1])}</a>` : styleRuns(m[0]));
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(styleRuns(text.slice(last)));
  return out.join('').replace(/\r?\n/g, '<br />');
}
function styleRuns(s: string): string {
  return esc(s)
    .replace(/\*\*([^*\n]{1,500})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]{1,500})\*(?!\*)/g, '$1<em>$2</em>');
}

const SOCIAL_LABEL: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube', tiktok: 'TikTok',
  telegram: 'Telegram', whatsapp: 'WhatsApp', website: 'Website',
};

/* Text glyphs that every mail client's system fonts carry (no icon font, no image to block). */
const GLYPH: Record<IconGlyph, string> = { check: '✓', star: '★', phone: '☎', mail: '✉', home: '⌂', pin: '●', key: '◆', arrow: '→' };

/* Button size presets: [paddingY, paddingX, fontSize]. */
const BUTTON_SIZE = { sm: [10, 20, 14], md: [14, 28, 15], lg: [18, 36, 17] } as const;

/**
 * A bulletproof button: the colour lives on the table cell (so Outlook paints it), the padding on
 * the link (so the whole button is clickable) and again as mso-padding-alt for Outlook, which
 * ignores padding on links. The hover colour is a class the optional <style> block fills.
 */
function buttonHtml(b: Pick<ButtonBlock, 'id' | 'label' | 'href' | 'align' | 'buttonColor' | 'textColor' | 'radius' | 'fullWidth' | 'fontSize' | 'fontWeight' | 'size' | 'paddingX' | 'paddingY' | 'strokeWidth' | 'strokeColor' | 'hoverColor'>, font: string, al: string, draft = false): string {
  /* A button without a destination is never sent; the designer (draft) still shows it so the
     author sees what to finish, and submission refuses it (BUTTON_LINK_MISSING). */
  if (!b.label.trim() || (!b.href && !draft)) return '';
  const [py0, px0, fs0] = BUTTON_SIZE[b.size ?? 'md'];
  const py = b.paddingY ?? py0, px = b.paddingX ?? px0, fs = b.fontSize ?? fs0;
  const stroke = b.strokeWidth && b.strokeColor ? `border:${b.strokeWidth}px solid ${b.strokeColor};` : '';
  const hover = b.hoverColor ? ` class="hm-btn-${b.id}"` : '';
  const a = `<a ${b.href ? `href="${attrUrl(b.href)}" target="_blank"` : 'data-hm-nolink="1"'}${hover} style="display:${b.fullWidth ? 'block' : 'inline-block'};padding:${py}px ${px}px;font-family:${font};font-size:${fs}px;font-weight:${b.fontWeight ?? 700};line-height:1.25;color:${b.textColor};text-decoration:none;border-radius:${b.radius}px;text-align:center;${WRAP}">${esc(b.label)}</a>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${b.fullWidth ? 'width="100%"' : ''} align="${b.fullWidth ? 'center' : al}" style="${b.fullWidth ? 'width:100%;' : ''}max-width:100%;border-collapse:separate;${al === 'center' && !b.fullWidth ? 'margin:0 auto;' : ''}"><tr><td bgcolor="${b.buttonColor}"${hover} style="background-color:${b.buttonColor};border-radius:${b.radius}px;text-align:center;mso-padding-alt:${py}px ${px}px;${stroke}">${a}</td></tr></table>`;
}

/* Draft only (designer canvas, template previews): where an image will go, at its proportions.
   Never in a stored or sent email — an empty image renders nothing there. */
const imageSlot = (w: number, h: number, radius = 0) =>
  `<div style="width:100%;max-width:${w}px;height:${h}px;margin:0 auto;border-radius:${radius}px;background-color:#E6E0D5;background-image:linear-gradient(135deg,#ECE7DE 25%,#E2DBCE 25%,#E2DBCE 50%,#ECE7DE 50%,#ECE7DE 75%,#E2DBCE 75%);background-size:24px 24px;"></div>`;

function cellAttrs(b: Block, theme: Theme, extraClass = ''): string {
  const cls = [b.hideOnMobile ? 'hm-hide-mobile' : '', b.hideOnDesktop ? 'hm-hide-desktop' : '', extraClass].filter(Boolean).join(' ');
  /* A section paints its colour on its own (rounded) box, not on the padded row around it. */
  const rowBg = b.type === 'section' ? null : b.background;
  const bg = rowBg ? `background-color:${rowBg};` : '';
  /* A card draws its own border around the card, not around the padded row. */
  const border = b.type !== 'card' && b.borderWidth && b.borderColor ? `border:${b.borderWidth}px solid ${b.borderColor};` : '';
  const desktopHidden = b.hideOnDesktop ? 'display:none;mso-hide:all;max-height:0;overflow:hidden;' : '';
  void theme;
  return `${cls ? ` class="${cls}"` : ''} style="padding:${padCss(b.padding)};${bg}${border}${desktopHidden}"${rowBg ? ` bgcolor="${rowBg}"` : ''}`;
}

function leafHtml(b: LeafBlock, theme: Theme, width: number, dirAlign: 'left' | 'right', draft = false): string {
  const font = FONT_STACKS[('fontFamily' in b && b.fontFamily) || theme.fontFamily];
  const al = (a: string) => (a === 'left' ? dirAlign : a === 'right' ? (dirAlign === 'left' ? 'right' : 'left') : 'center');
  switch (b.type) {
    case 'heading': {
      const size = b.fontSize ?? (b.level === 1 ? 28 : b.level === 2 ? 22 : 18);
      const ls = b.letterSpacing ? `letter-spacing:${b.letterSpacing / 100}em;` : '';
      const body = b.rich ? richToEmailHtml(b.rich, b.color ?? theme.link) : inlineMarkup(b.text, theme.link);
      return `<h${b.level} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.3;font-weight:${b.fontWeight ?? 700};color:${b.color ?? theme.text};text-align:${al(b.align)};${ls}${WRAP}">${body}</h${b.level}>`;
    }
    case 'text': {
      const body = b.rich ? richToEmailHtml(b.rich, theme.link) : inlineMarkup(b.text, theme.link);
      return `<div style="margin:0;font-family:${font};font-size:${b.fontSize ?? 16}px;line-height:${b.lineHeight ?? 1.65};font-weight:${b.fontWeight ?? 400};color:${b.color ?? theme.text};text-align:${al(b.align)};${WRAP}">${body}</div>`;
    }
    case 'image': {
      if (!b.src) return draft ? imageSlot(Math.min(b.width, width), Math.round(Math.min(b.width, width) * 0.56), b.radius ?? 0) : '';
      const w = Math.min(b.width, width);
      const img = `<img src="${attrUrl(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${b.radius ?? 0}px;${b.align === 'center' ? 'margin:0 auto;' : ''}" />`;
      return `<div style="text-align:${al(b.align)};">${b.href ? `<a href="${attrUrl(b.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img}</div>`;
    }
    case 'button':
      return buttonHtml(b, font, al(b.align), draft);
    case 'banner': {
      const a = al(b.align);
      const parts = [
        b.imageSrc ? `<img src="${attrUrl(b.imageSrc)}" alt="${esc(b.imageAlt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;margin:0 0 22px 0;" />` : '',
        b.eyebrow ? `<div style="font-family:${font};font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.18em;color:${b.buttonColor};text-align:${a};margin:0 0 10px 0;">${esc(b.eyebrow)}</div>` : '',
        b.title ? `<h1 style="margin:0;font-family:${font};font-size:30px;line-height:1.2;font-weight:700;color:${b.textColor};text-align:${a};">${esc(b.title)}</h1>` : '',
        b.subtitle ? `<div style="font-family:${font};font-size:16px;line-height:1.6;color:${b.textColor};text-align:${a};margin:12px 0 0 0;">${inlineMarkup(b.subtitle, b.buttonColor)}</div>` : '',
      ];
      const btn = buttonHtml({ id: b.id, label: b.buttonLabel, href: b.buttonHref, align: b.align, buttonColor: b.buttonColor, textColor: b.buttonTextColor, radius: b.radius, size: 'md' }, font, a, draft);
      return `${parts.join('')}${btn ? `<div style="height:22px;line-height:22px;font-size:0;">&nbsp;</div>${btn}` : ''}`;
    }
    case 'card': {
      const a = al(b.align);
      const border = b.borderWidth && b.borderColor ? `border:${b.borderWidth}px solid ${b.borderColor};` : '';
      const btn = buttonHtml({ id: b.id, label: b.buttonLabel, href: b.buttonHref, align: b.align, buttonColor: b.buttonColor, textColor: b.buttonTextColor, radius: Math.min(b.radius, 10), size: 'sm' }, font, a, draft);
      const content = [
        b.title ? `<div style="font-family:${font};font-size:19px;line-height:1.3;font-weight:700;color:${theme.text};text-align:${a};margin:0 0 6px 0;">${esc(b.title)}</div>` : '',
        b.text ? `<div style="font-family:${font};font-size:15px;line-height:1.6;color:${theme.text};text-align:${a};">${inlineMarkup(b.text, theme.link)}</div>` : '',
        btn ? `<div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>${btn}` : '',
      ].join('');
      const imgW = b.layout === 'side' ? Math.floor(width * 0.42) : width;
      const img = b.imageSrc ? `<img src="${attrUrl(b.imageSrc)}" alt="${esc(b.imageAlt)}" width="${imgW}" style="display:block;width:100%;max-width:${imgW}px;height:auto;border:0;border-radius:${Math.max(0, b.radius - 2)}px;" />`
        : draft ? imageSlot(imgW, Math.round(imgW * 0.62), Math.max(0, b.radius - 2)) : '';
      const inner = b.layout === 'side' && img
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="hm-col" width="${imgW}" valign="top" style="width:${imgW}px;vertical-align:top;padding:0 18px 0 0;">${img}</td><td class="hm-col" valign="top" style="vertical-align:top;">${content}</td></tr></table>`
        : `${img ? `${img}<div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>` : ''}${content}`;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td bgcolor="${b.cardColor}" style="background-color:${b.cardColor};border-radius:${b.radius}px;padding:20px;${border}">${inner}</td></tr></table>`;
    }
    case 'header': {
      const logo = b.logoSrc ? `<img src="${attrUrl(b.logoSrc)}" alt="${esc(b.logoAlt || b.brand)}" width="${b.logoWidth}" style="display:inline-block;width:${b.logoWidth}px;max-width:100%;height:auto;border:0;vertical-align:middle;" />` : '';
      const linked = (s: string) => (b.href && s ? `<a href="${attrUrl(b.href)}" target="_blank" style="text-decoration:none;color:${b.textColor};">${s}</a>` : s);
      const brand = b.brand ? `<div style="font-family:${font};font-size:17px;line-height:1.3;font-weight:800;letter-spacing:0.08em;color:${b.textColor};">${esc(b.brand)}</div>` : '';
      const tag = b.tagline ? `<div style="font-family:${font};font-size:12px;line-height:1.5;color:${b.textColor};margin-top:2px;">${esc(b.tagline)}</div>` : '';
      const a = al(b.align);
      if (a === 'center' || !logo || !(brand || tag)) {
        return `<div style="text-align:${a};">${linked(logo)}${logo && (brand || tag) ? '<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>' : ''}${linked(brand)}${tag}</div>`;
      }
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}"><tr><td valign="middle" style="vertical-align:middle;padding:0 14px 0 0;">${linked(logo)}</td><td valign="middle" style="vertical-align:middle;text-align:${a};">${linked(brand)}${tag}</td></tr></table>`;
    }
    case 'facts': {
      if (!b.items.length) return '';
      const n = b.columns;
      const cellW = Math.floor(100 / n);
      const rows: string[] = [];
      for (let i = 0; i < b.items.length; i += n) {
        const cells = b.items.slice(i, i + n).map((it) => `<td class="hm-col" width="${cellW}%" valign="top" style="width:${cellW}%;vertical-align:top;padding:6px;"><div style="${b.tileColor ? `background-color:${b.tileColor};` : ''}border-radius:10px;padding:${b.tileColor ? '14px 12px' : '4px 0'};text-align:center;">
<div style="font-family:${font};font-size:20px;line-height:1.25;font-weight:700;color:${b.valueColor ?? theme.text};">${esc(it.value)}</div>
<div style="font-family:${font};font-size:12px;line-height:1.4;letter-spacing:0.06em;color:${b.labelColor ?? theme.muted};margin-top:4px;">${esc(it.label)}</div></div></td>`);
        rows.push(`<tr>${cells.join('')}</tr>`);
      }
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`;
    }
    case 'divider': {
      const rule = `<div style="height:${b.thickness}px;line-height:${b.thickness}px;font-size:0;background-color:${b.color};">&nbsp;</div>`;
      if (!b.widthPct || b.widthPct >= 100) return rule;
      return `<table role="presentation" width="${b.widthPct}%" align="center" cellpadding="0" cellspacing="0" border="0" style="width:${b.widthPct}%;margin:0 auto;"><tr><td>${rule}</td></tr></table>`;
    }
    case 'spacer':
      return `<div style="height:${b.height}px;line-height:${b.height}px;font-size:0;">&nbsp;</div>`;
    case 'logo': {
      if (!b.src) return '';
      const img = `<img src="${attrUrl(b.src)}" alt="${esc(b.alt)}" width="${b.width}" style="display:inline-block;width:${b.width}px;max-width:100%;height:auto;border:0;" />`;
      return `<div style="text-align:${al(b.align)};">${b.href ? `<a href="${attrUrl(b.href)}" target="_blank">${img}</a>` : img}</div>`;
    }
    case 'social': {
      if (!b.links.length) return '';
      const items = b.links.map((l) => `<a href="${attrUrl(l.url)}" target="_blank" style="display:inline-block;margin:0 6px 6px 6px;padding:7px 12px;border:1px solid ${theme.accent};border-radius:999px;font-family:${font};font-size:12px;font-weight:600;color:${theme.text};text-decoration:none;">${esc(SOCIAL_LABEL[l.network] ?? 'Link')}</a>`);
      return `<div style="text-align:${al(b.align)};">${items.join('')}</div>`;
    }
    case 'footer':
      return `<div style="font-family:${font};font-size:12px;line-height:1.6;color:${b.color ?? theme.muted};text-align:${al(b.align)};">${inlineMarkup(b.text, theme.muted)}</div>`;
    case 'contact': {
      const lines = [
        b.name && `<strong>${esc(b.name)}</strong>`,
        b.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email) && `<a href="mailto:${attrUrl(b.email)}" style="color:${theme.link};">${esc(b.email)}</a>`,
        b.phone && /^\+?[0-9 ()-]{5,20}$/.test(b.phone) && `<a href="tel:${attrUrl(b.phone.replace(/[^\d+]/g, ''))}" style="color:${theme.link};">${esc(b.phone)}</a>`,
        b.address && esc(b.address),
      ].filter(Boolean);
      return `<div style="font-family:${font};font-size:14px;line-height:1.6;color:${theme.text};text-align:${al(b.align)};">${lines.join('<br />')}</div>`;
    }
    case 'unsubscribe':
      return `<div style="font-family:${font};font-size:12px;line-height:1.6;color:${theme.muted};text-align:${al(b.align)};"><a href="{{unsubscribe_url}}" target="_blank" style="color:${theme.muted};text-decoration:underline;">${esc(b.text.trim() || 'Unsubscribe')}</a></div>`;
    case 'badge': {
      if (!b.text.trim()) return draft ? `<div style="text-align:${al(b.align)};"><span style="display:inline-block;padding:4px 12px;border:1px dashed ${b.color};border-radius:${b.radius}px;font-family:${font};font-size:11px;color:${theme.muted};">&nbsp;&nbsp;&nbsp;&nbsp;</span></div>` : '';
      const a = al(b.align);
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}" style="border-collapse:separate;${a === 'center' ? 'margin:0 auto;' : ''}"><tr><td bgcolor="${b.color}" style="background-color:${b.color};border-radius:${b.radius}px;padding:4px 12px;font-family:${font};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${b.textColor};">${esc(b.text)}</td></tr></table>`;
    }
    case 'icon': {
      if (!b.label.trim() && !draft) return '';
      const a = al(b.align);
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${a}" style="${a === 'center' ? 'margin:0 auto;' : ''}"><tr><td valign="middle" style="vertical-align:middle;padding:0 ${dirAlign === 'left' ? '10px 0 0' : '0 0 10px'};font-family:${font};font-size:${b.size}px;line-height:1;color:${b.color};">${GLYPH[b.glyph]}</td><td valign="middle" style="vertical-align:middle;font-family:${font};font-size:15px;line-height:1.5;color:${theme.text};">${inlineMarkup(b.label, theme.link)}</td></tr></table>`;
    }
    case 'gallery': {
      const imgs = b.images.filter((x) => x.src || draft);
      if (!imgs.length) return '';
      const n = imgs.length;
      const w = Math.floor((width - b.gap * (n - 1)) / n);
      const cells = imgs.map((x, i) => {
        const img = x.src
          ? `<img src="${attrUrl(x.src)}" alt="${esc(x.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:${b.radius}px;" />`
          : imageSlot(w, Math.round(w * 0.75), b.radius);
        const linked = x.href && x.src ? `<a href="${attrUrl(x.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
        const gap = i < n - 1 ? `<td class="hm-gap" width="${b.gap}" style="width:${b.gap}px;font-size:0;line-height:0;">&nbsp;</td>` : '';
        return `<td class="hm-col hm-col-gap" width="${w}" valign="top" style="width:${w}px;vertical-align:top;">${linked}</td>${gap}`;
      });
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells.join('')}</tr></table>`;
    }
    case 'video': {
      /* No inline video in email: the thumbnail (whose play mark the designer composes into the
         image itself, so it survives every client) links to the video page; the caption is a link too. */
      const w = Math.min(b.width, width);
      if (!b.thumbSrc) return draft ? imageSlot(w, Math.round(w * 0.56), b.radius) : '';
      const img = `<img src="${attrUrl(b.thumbSrc)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;border-radius:${b.radius}px;${b.align === 'center' ? 'margin:0 auto;' : ''}" />`;
      const cap = b.caption.trim() ? `<div style="font-family:${font};font-size:14px;line-height:1.5;margin-top:8px;text-align:${al(b.align)};">${b.href ? `<a href="${attrUrl(b.href)}" target="_blank" style="color:${theme.link};text-decoration:underline;">▶ ${esc(b.caption)}</a>` : `▶ ${esc(b.caption)}`}</div>` : '';
      return `<div style="text-align:${al(b.align)};">${b.href ? `<a href="${attrUrl(b.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img}${cap}</div>`;
    }
    case 'html':
      /* Already reduced to the email-safe allowlist by normalizeDoc (emailHtml.ts). */
      return b.html ? `<div style="font-family:${font};color:${theme.text};">${b.html}</div>` : '';
  }
}

const ratioOf = (r: ColumnsBlock['ratio']): [number, number] => {
  const [a, b] = r.split('-').map(Number);
  return [a, b];
};
const spacerDiv = (h: number) => (h > 0 ? `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>` : '');
const innerWidth = (b: Block, width: number) => width - (b.padding ? b.padding.l + b.padding.r : 64) - 2 * (b.type !== 'card' ? b.borderWidth ?? 0 : 0);

function columnsHtml(b: ColumnsBlock, theme: Theme, width: number, dirAlign: 'left' | 'right', draft = false): string {
  const [l, r] = ratioOf(b.ratio);
  const inner = innerWidth(b, width);
  const w1 = Math.floor((inner - b.gap) * l / 100), w2 = Math.floor((inner - b.gap) * r / 100);
  const col = (blocks: LeafBlock[], w: number) => blocks.filter((x) => draft || !x.hidden).map((x) => `${spacerDiv(x.margin?.t ?? 0)}<div${x.hideOnMobile ? ' class="hm-hide-mobile"' : ''} style="padding:${padCss({ ...(x.padding ?? { t: 6, r: 0, b: 6, l: 0 }), l: 0, r: 0 })};${x.background ? `background-color:${x.background};` : ''}">${leafHtml(x, theme, w, dirAlign, draft)}</div>${spacerDiv(x.margin?.b ?? 0)}`).join('');
  const stack = b.stackOnMobile ? ' class="hm-col"' : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td${stack} width="${w1}" valign="top" style="width:${w1}px;vertical-align:top;">${col(b.columns[0], w1)}</td>
<td${stack ? ' class="hm-gap"' : ''} width="${b.gap}" style="width:${b.gap}px;font-size:0;line-height:0;">&nbsp;</td>
<td${stack} width="${w2}" valign="top" style="width:${w2}px;vertical-align:top;">${col(b.columns[1], w2)}</td>
</tr></table>`;
}

/**
 * A container: one nested table whose cell carries the background colour (bgcolor and style, so
 * Outlook paints it), an optional background image over that colour (clients that drop
 * background images show the colour, which is why the colour is required for readable text), the
 * radius and border; its children are rows of the same renderer.
 */
function sectionHtml(b: SectionBlock, theme: Theme, width: number, dirAlign: 'left' | 'right', draft = false): string {
  const inner = innerWidth(b, width);
  const kids = b.children.filter((x) => draft || !x.hidden).map((x) => {
    const content = x.type === 'columns' ? columnsHtml(x, theme, inner, dirAlign, draft) : leafHtml(x, theme, innerWidth(x, inner), dirAlign, draft);
    if (!content) return '';
    return `${x.margin?.t ? `<tr><td style="font-size:0;line-height:0;height:${x.margin.t}px;">&nbsp;</td></tr>` : ''}<tr><td${cellAttrs(x, theme)}>${content}</td></tr>${x.margin?.b ? `<tr><td style="font-size:0;line-height:0;height:${x.margin.b}px;">&nbsp;</td></tr>` : ''}`;
  }).filter(Boolean);
  if (!kids.length && !draft) return '';
  const bg = b.background ?? theme.card;
  const img = b.bgImage ? ` background="${attrUrl(b.bgImage)}"` : '';
  const imgCss = b.bgImage ? `background-image:url('${attrUrl(b.bgImage)}');background-size:cover;background-position:center;` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td bgcolor="${bg}"${img} style="background-color:${bg};${imgCss}border-radius:${b.radius}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${kids.join('')}</table></td></tr></table>`;
}

function blockContent(b: Block, theme: Theme, width: number, dirAlign: 'left' | 'right', draft = false): string {
  if (b.type === 'columns') return columnsHtml(b, theme, width, dirAlign, draft);
  if (b.type === 'section') return sectionHtml(b, theme, width, dirAlign, draft);
  return leafHtml(b, theme, innerWidth(b, width), dirAlign, draft);
}

/**
 * One block as the designer canvas shows it: the SAME renderer output (escaped, inline-styled,
 * no <style>, no script) inside its padded cell, so what the canvas shows is what is sent.
 */
export function renderBlockHtml(b: Block, theme: Theme, rtl = false, draft = true): string {
  const dirAlign = rtl ? 'right' : 'left';
  const inner = blockContent(b, theme, theme.width, dirAlign, draft);
  const bg = b.background && b.type !== 'section' ? `background-color:${b.background};` : '';
  const border = b.borderWidth && b.borderColor ? `border:${b.borderWidth}px solid ${b.borderColor};` : '';
  return `<div style="padding:${padCss(b.padding)};${bg}${border}">${inner}</div>`;
}

export interface RenderedBody { html: string; text: string; theme: Theme }

/** The designed body: one self-contained table (plus the marker carrying canvas/width). */
export function renderDesignBody(input: unknown, opts: { rtl?: boolean; draft?: boolean } = {}): RenderedBody {
  const doc: EmailDoc = normalizeDoc(input);
  const t = doc.theme;
  const dirAlign = opts.rtl ? 'right' : 'left';
  /* A hidden layer is the author's "leave it out": never in a stored or sent email. */
  const rows = doc.blocks.filter((b) => opts.draft || !b.hidden).map((b) => {
    const content = blockContent(b, t, t.width, dirAlign, opts.draft);
    if (!content) return '';
    const gap = (h?: number) => (h ? `<tr><td style="font-size:0;line-height:0;height:${h}px;">&nbsp;</td></tr>` : '');
    return `${gap(b.margin?.t)}<tr><td${cellAttrs(b, t)}>${content}</td></tr>${gap(b.margin?.b)}`;
  }).filter(Boolean);
  const hovers = walkBlocks(doc.blocks)
    .filter((b): b is ButtonBlock => b.type === 'button' && Boolean(b.hoverColor))
    .map((b) => `td.hm-btn-${b.id}:hover,a.hm-btn-${b.id}:hover{background-color:${b.hoverColor}!important;}`).join('');
  const style = `<style type="text/css">${hovers}@media only screen and (max-width:620px){.hm-col{display:block!important;width:100%!important;max-width:100%!important;padding-left:0!important;padding-right:0!important;}.hm-gap{display:none!important;}.hm-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important;}.hm-hide-desktop{display:table-cell!important;max-height:none!important;}.hm-body{width:100%!important;}}</style>`;
  const html = `${DESIGN_MARKER} canvas=${t.canvas} card=${t.card} width=${t.width} radius=${t.radius}-->
${style}
<table role="presentation" class="hm-body" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${t.card}" style="width:100%;background-color:${t.card};border-collapse:collapse;">
${rows.join('\n')}
</table>`;
  return { html, text: designToText(doc), theme: t };
}

/** A plain-text alternative: what a reader of the text part needs, in order. */
export function designToText(doc: EmailDoc): string {
  const strip = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  const leaf = (b: LeafBlock): string => {
    switch (b.type) {
      case 'heading': case 'text': return b.rich ? richToText(b.rich) : strip(b.text);
      case 'footer': return strip(b.text);
      case 'button': return b.label && b.href ? `${b.label}: ${b.href}` : '';
      case 'banner': return [b.eyebrow, b.title, strip(b.subtitle), b.buttonLabel && b.buttonHref ? `${b.buttonLabel}: ${b.buttonHref}` : ''].filter(Boolean).join('\n');
      case 'card': return [b.title, strip(b.text), b.buttonLabel && b.buttonHref ? `${b.buttonLabel}: ${b.buttonHref}` : ''].filter(Boolean).join('\n');
      case 'header': return [b.brand, b.tagline].filter(Boolean).join('\n');
      case 'facts': return b.items.map((it) => [it.label, it.value].filter(Boolean).join(': ')).join('\n');
      case 'image': return b.href ? `${b.alt || 'Image'}: ${b.href}` : '';
      case 'social': return b.links.map((l) => `${SOCIAL_LABEL[l.network]}: ${l.url}`).join('\n');
      case 'contact': return [b.name, b.email, b.phone, b.address].filter(Boolean).join('\n');
      case 'unsubscribe': return `${b.text.trim() || 'Unsubscribe'}: {{unsubscribe_url}}`;
      case 'badge': return b.text;
      case 'icon': return strip(b.label);
      case 'gallery': return b.images.filter((x) => x.src && x.href).map((x) => `${x.alt || 'Image'}: ${x.href}`).join('\n');
      case 'video': return b.href ? `${b.caption || b.alt || 'Video'}: ${b.href}` : '';
      case 'html': return emailHtmlToText(b.html);
      default: return '';
    }
  };
  const one = (b: Block): string => {
    if (b.hidden) return '';
    if (b.type === 'columns') return [...b.columns[0], ...b.columns[1]].map(one).filter(Boolean).join('\n\n');
    if (b.type === 'section') return b.children.map(one).filter(Boolean).join('\n\n');
    return leaf(b);
  };
  return doc.blocks.map(one)
    .filter((s) => s.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Read the marker back: the canvas/width a designed body asks its wrapper for. */
export function readDesignMarker(html: string | null | undefined): { canvas: string; card: string; width: number; radius: number } | null {
  const m = /^<!--homatch-designer:v1 canvas=(#[0-9A-Fa-f]{6}) card=(#[0-9A-Fa-f]{6}) width=(\d{3}) radius=(\d{1,2})-->/.exec(String(html ?? '').trimStart());
  return m ? { canvas: m[1], card: m[2], width: Number(m[3]), radius: Number(m[4]) } : null;
}
