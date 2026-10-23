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
  type Block, type ColumnsBlock, type EmailDoc, FONT_STACKS, type LeafBlock, normalizeDoc, type Pad, type Theme,
} from './document.ts';

export const DESIGN_MARKER = '<!--homatch-designer:v1';

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

function cellAttrs(b: Block, theme: Theme, extraClass = ''): string {
  const cls = [b.hideOnMobile ? 'hm-hide-mobile' : '', b.hideOnDesktop ? 'hm-hide-desktop' : '', extraClass].filter(Boolean).join(' ');
  const bg = b.background ? `background-color:${b.background};` : '';
  const border = b.borderWidth && b.borderColor ? `border:${b.borderWidth}px solid ${b.borderColor};` : '';
  const desktopHidden = b.hideOnDesktop ? 'display:none;mso-hide:all;max-height:0;overflow:hidden;' : '';
  void theme;
  return `${cls ? ` class="${cls}"` : ''} style="padding:${padCss(b.padding)};${bg}${border}${desktopHidden}"${b.background ? ` bgcolor="${b.background}"` : ''}`;
}

function leafHtml(b: LeafBlock, theme: Theme, width: number, dirAlign: 'left' | 'right'): string {
  const font = FONT_STACKS[('fontFamily' in b && b.fontFamily) || theme.fontFamily];
  const al = (a: string) => (a === 'left' ? dirAlign : a === 'right' ? (dirAlign === 'left' ? 'right' : 'left') : 'center');
  switch (b.type) {
    case 'heading': {
      const size = b.fontSize ?? (b.level === 1 ? 28 : b.level === 2 ? 22 : 18);
      return `<h${b.level} style="margin:0;font-family:${font};font-size:${size}px;line-height:1.3;font-weight:${b.fontWeight ?? 700};color:${b.color ?? theme.text};text-align:${al(b.align)};">${inlineMarkup(b.text, theme.link)}</h${b.level}>`;
    }
    case 'text':
      return `<div style="margin:0;font-family:${font};font-size:${b.fontSize ?? 16}px;line-height:${b.lineHeight ?? 1.65};font-weight:${b.fontWeight ?? 400};color:${b.color ?? theme.text};text-align:${al(b.align)};">${inlineMarkup(b.text, theme.link)}</div>`;
    case 'image': {
      if (!b.src) return '';
      const w = Math.min(b.width, width);
      const img = `<img src="${attrUrl(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:${b.radius ?? 0}px;${b.align === 'center' ? 'margin:0 auto;' : ''}" />`;
      return `<div style="text-align:${al(b.align)};">${b.href ? `<a href="${attrUrl(b.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img}</div>`;
    }
    case 'button': {
      if (!b.label.trim() || !b.href) return '';
      const fs = b.fontSize ?? 15;
      const a = `<a href="${attrUrl(b.href)}" target="_blank" style="display:${b.fullWidth ? 'block' : 'inline-block'};padding:14px 28px;font-family:${font};font-size:${fs}px;font-weight:${b.fontWeight ?? 700};line-height:1.2;color:${b.textColor};text-decoration:none;border-radius:${b.radius}px;text-align:center;">${esc(b.label)}</a>`;
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${b.fullWidth ? 'width="100%"' : ''} align="${b.fullWidth ? 'center' : al(b.align)}" style="${b.fullWidth ? 'width:100%;' : ''}border-collapse:separate;"><tr><td bgcolor="${b.buttonColor}" style="background-color:${b.buttonColor};border-radius:${b.radius}px;text-align:center;">${a}</td></tr></table>`;
    }
    case 'divider':
      return `<div style="height:${b.thickness}px;line-height:${b.thickness}px;font-size:0;background-color:${b.color};">&nbsp;</div>`;
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
  }
}

function columnsHtml(b: ColumnsBlock, theme: Theme, width: number, dirAlign: 'left' | 'right'): string {
  const [l, r] = b.ratio === '40-60' ? [40, 60] : b.ratio === '60-40' ? [60, 40] : [50, 50];
  const inner = width - (b.padding ? b.padding.l + b.padding.r : 64);
  const w1 = Math.floor((inner - b.gap) * l / 100), w2 = Math.floor((inner - b.gap) * r / 100);
  const col = (blocks: LeafBlock[], w: number) => blocks.map((x) => `<div style="padding:${padCss({ ...(x.padding ?? { t: 6, r: 0, b: 6, l: 0 }), l: 0, r: 0 })};${x.background ? `background-color:${x.background};` : ''}">${leafHtml(x, theme, w, dirAlign)}</div>`).join('');
  const stack = b.stackOnMobile ? ' class="hm-col"' : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td${stack} width="${w1}" valign="top" style="width:${w1}px;vertical-align:top;">${col(b.columns[0], w1)}</td>
<td${stack ? ' class="hm-gap"' : ''} width="${b.gap}" style="width:${b.gap}px;font-size:0;line-height:0;">&nbsp;</td>
<td${stack} width="${w2}" valign="top" style="width:${w2}px;vertical-align:top;">${col(b.columns[1], w2)}</td>
</tr></table>`;
}

export interface RenderedBody { html: string; text: string; theme: Theme }

/** The designed body: one self-contained table (plus the marker carrying canvas/width). */
export function renderDesignBody(input: unknown, opts: { rtl?: boolean } = {}): RenderedBody {
  const doc: EmailDoc = normalizeDoc(input);
  const t = doc.theme;
  const dirAlign = opts.rtl ? 'right' : 'left';
  const rows = doc.blocks.map((b) => {
    const content = b.type === 'columns' ? columnsHtml(b, t, t.width, dirAlign) : leafHtml(b, t, t.width - (b.padding ? b.padding.l + b.padding.r : 64), dirAlign);
    if (!content) return '';
    return `<tr><td${cellAttrs(b, t)}>${content}</td></tr>`;
  }).filter(Boolean);
  const style = `<style type="text/css">@media only screen and (max-width:620px){.hm-col{display:block!important;width:100%!important;max-width:100%!important;}.hm-gap{display:none!important;}.hm-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important;}.hm-hide-desktop{display:table-cell!important;max-height:none!important;}.hm-body{width:100%!important;}}</style>`;
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
      case 'heading': return strip(b.text).toUpperCase() === strip(b.text) ? strip(b.text) : strip(b.text);
      case 'text': case 'footer': return strip(b.text);
      case 'button': return b.label && b.href ? `${b.label}: ${b.href}` : '';
      case 'image': return b.href ? `${b.alt || 'Image'}: ${b.href}` : '';
      case 'social': return b.links.map((l) => `${SOCIAL_LABEL[l.network]}: ${l.url}`).join('\n');
      case 'contact': return [b.name, b.email, b.phone, b.address].filter(Boolean).join('\n');
      case 'unsubscribe': return `${b.text.trim() || 'Unsubscribe'}: {{unsubscribe_url}}`;
      default: return '';
    }
  };
  return doc.blocks.map((b) => (b.type === 'columns' ? [...b.columns[0], ...b.columns[1]].map(leaf).filter(Boolean).join('\n\n') : leaf(b)))
    .filter((s) => s.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Read the marker back: the canvas/width a designed body asks its wrapper for. */
export function readDesignMarker(html: string | null | undefined): { canvas: string; card: string; width: number; radius: number } | null {
  const m = /^<!--homatch-designer:v1 canvas=(#[0-9A-Fa-f]{6}) card=(#[0-9A-Fa-f]{6}) width=(\d{3}) radius=(\d{1,2})-->/.exec(String(html ?? '').trimStart());
  return m ? { canvas: m[1], card: m[2], width: Number(m[3]), radius: Number(m[4]) } : null;
}
