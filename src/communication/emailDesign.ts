// EMAIL STUDIO — the design model, its sanitiser and its renderer.
//
// One module, imported by the browser editor AND by the communication-studio-ai
// edge function, so what the AI proposes, what the customer edits, what the
// preview shows and what outreach-send delivers are the same document rendered
// by the same code. Pure TypeScript with no path aliases: Deno imports it as-is.
//
// SAFETY. A design is untrusted input every time it crosses a boundary (a model
// reply, a saved draft, a pasted template). sanitizeDesign() keeps only known
// block types, clamps every number, accepts only https: image sources and
// https:/mailto:/tel: links, and reduces rich text to an inline allowlist
// (b, strong, i, em, u, br, a). The renderer escapes everything else. The
// preview additionally renders inside a sandboxed iframe with no scripts.

export type Align = 'left' | 'center' | 'right';

export interface HeaderBlock { id: string; type: 'header'; brand: string; tagline: string }
export interface HeadingBlock { id: string; type: 'heading'; text: string; level: 1 | 2; align: Align }
export interface TextBlock { id: string; type: 'text'; html: string; align: Align }
export interface ImageBlock { id: string; type: 'image'; src: string; alt: string; width: number; align: Align; caption: string; href: string }
export interface GalleryBlock { id: string; type: 'gallery'; images: Array<{ src: string; alt: string }> }
export interface ButtonBlock { id: string; type: 'button'; label: string; href: string; align: Align }
export interface FactsBlock { id: string; type: 'facts'; items: Array<{ label: string; value: string }> }
export interface DividerBlock { id: string; type: 'divider' }
export interface SpacerBlock { id: string; type: 'spacer'; size: number }
export interface FooterBlock { id: string; type: 'footer'; text: string }

export type Block =
  | HeaderBlock | HeadingBlock | TextBlock | ImageBlock | GalleryBlock
  | ButtonBlock | FactsBlock | DividerBlock | SpacerBlock | FooterBlock;
export type BlockType = Block['type'];

export interface EmailTheme { accent: string; background: string; surface: string; ink: string; font: 'serif' | 'sans' }
export interface EmailDesign { version: 1; theme: EmailTheme; blocks: Block[] }

export const BLOCK_TYPES: BlockType[] = ['header', 'heading', 'text', 'image', 'gallery', 'button', 'facts', 'divider', 'spacer', 'footer'];
export const MAX_BLOCKS = 40;

export const DEFAULT_THEME: EmailTheme = {
  accent: '#C9962B', background: '#F4F1EA', surface: '#FFFFFF', ink: '#14213D', font: 'sans',
};

export const THEMES: Record<'gold' | 'navy' | 'ivory' | 'slate', EmailTheme> = {
  gold: DEFAULT_THEME,
  navy: { accent: '#E2B04A', background: '#0E1A2E', surface: '#FFFFFF', ink: '#0E1A2E', font: 'serif' },
  ivory: { accent: '#8A6A2F', background: '#FBF8F2', surface: '#FFFFFF', ink: '#2B2A26', font: 'serif' },
  slate: { accent: '#2F6FDE', background: '#EEF1F6', surface: '#FFFFFF', ink: '#1C2533', font: 'sans' },
};

let seq = 0;
export function newId(prefix = 'b'): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyDesign(): EmailDesign {
  return { version: 1, theme: { ...DEFAULT_THEME }, blocks: [] };
}

export function makeBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case 'header': return { id, type, brand: 'HOMATCH', tagline: '' };
    case 'heading': return { id, type, text: '', level: 1, align: 'left' };
    case 'text': return { id, type, html: '', align: 'left' };
    case 'image': return { id, type, src: '', alt: '', width: 100, align: 'center', caption: '', href: '' };
    case 'gallery': return { id, type, images: [] };
    case 'button': return { id, type, label: '', href: '', align: 'center' };
    case 'facts': return { id, type, items: [] };
    case 'divider': return { id, type };
    case 'spacer': return { id, type, size: 24 };
    case 'footer': return { id, type, text: '' };
  }
}

/* ── primitives ─────────────────────────────────────────────────────────── */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};
const align = (v: unknown): Align => (v === 'center' || v === 'right' ? v : 'left');
const color = (v: unknown, dflt: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : dflt);

/** An image source a mail client can load and nobody can abuse: https only. */
export function safeImageSrc(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString().slice(0, 2000) : '';
  } catch { return ''; }
}

/** A link target: https, mailto or tel. Anything else (javascript:, data:, http:) is dropped. */
export function safeHref(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (/^mailto:[^\s<>"']+$/i.test(s) || /^tel:\+?[0-9 ()-]{3,30}$/i.test(s)) return s.slice(0, 500);
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString().slice(0, 2000) : '';
  } catch { return ''; }
}

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u', 'a']);

/**
 * Rich text, reduced to an inline allowlist. Block-level tags a contentEditable
 * produces (div, p) become line breaks; every other tag is removed and its text
 * kept; text is escaped; unclosed tags are closed so formatting cannot leak.
 */
export function sanitizeInline(input: unknown, max = 6000): string {
  const html = str(input, max * 2);
  const parts = html.split(/(<[^>]*>)/g);
  const out: string[] = [];
  const open: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (!part.startsWith('<')) {
      out.push(part
        .replace(/&(?!(?:amp|lt|gt|quot|#39|nbsp|#\d{1,6});)/g, '&amp;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      continue;
    }
    const m = /^<\s*(\/?)\s*([a-zA-Z0-9]+)\b([^>]*)>$/.exec(part);
    if (!m) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') { out.push('<br>'); continue; }
    if (tag === 'div' || tag === 'p') { if (!closing && out.length) out.push('<br>'); continue; }
    if (!INLINE.has(tag)) continue;
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (tag === 'a') {
      const hm = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
      const href = safeHref(hm ? (hm[1] ?? hm[2] ?? '').replace(/&amp;/g, '&') : '');
      if (!href) continue;
      out.push(`<a href="${escapeHtml(href)}">`);
    } else {
      out.push(`<${tag}>`);
    }
    open.push(tag);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('').slice(0, max);
}

/** Plain text of a rich-text fragment (for text_body and AI context). */
export function inlineToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href, text) => `${text} (${String(href).replace(/&amp;/g, '&')})`)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/* ── the sanitiser ──────────────────────────────────────────────────────── */

function sanitizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const id = typeof b.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.id) ? b.id : newId();
  switch (b.type) {
    case 'header': return { id, type: 'header', brand: str(b.brand, 60) || 'HOMATCH', tagline: str(b.tagline, 120) };
    case 'heading': return { id, type: 'heading', text: str(b.text, 200), level: b.level === 2 ? 2 : 1, align: align(b.align) };
    case 'text': return { id, type: 'text', html: sanitizeInline(b.html), align: align(b.align) };
    case 'image': {
      const src = safeImageSrc(b.src);
      return { id, type: 'image', src, alt: str(b.alt, 200), width: num(b.width, 20, 100, 100), align: align(b.align), caption: str(b.caption, 200), href: safeHref(b.href) };
    }
    case 'gallery': {
      const images = (Array.isArray(b.images) ? b.images : [])
        .map((i) => ({ src: safeImageSrc((i as Record<string, unknown>)?.src), alt: str((i as Record<string, unknown>)?.alt, 200) }))
        .filter((i) => i.src).slice(0, 3);
      return { id, type: 'gallery', images };
    }
    case 'button': return { id, type: 'button', label: str(b.label, 60), href: safeHref(b.href), align: align(b.align) };
    case 'facts': {
      const items = (Array.isArray(b.items) ? b.items : [])
        .map((i) => ({ label: str((i as Record<string, unknown>)?.label, 40), value: str((i as Record<string, unknown>)?.value, 80) }))
        .filter((i) => i.label && i.value).slice(0, 8);
      return { id, type: 'facts', items };
    }
    case 'divider': return { id, type: 'divider' };
    case 'spacer': return { id, type: 'spacer', size: num(b.size, 8, 96, 24) };
    case 'footer': return { id, type: 'footer', text: str(b.text, 500) };
    default: return null;
  }
}

export function sanitizeDesign(raw: unknown): EmailDesign {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = (d.theme && typeof d.theme === 'object' ? d.theme : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const blocks = (Array.isArray(d.blocks) ? d.blocks : [])
    .map(sanitizeBlock)
    .filter((b): b is Block => b !== null)
    .map((b) => { if (seen.has(b.id)) b = { ...b, id: newId() }; seen.add(b.id); return b; })
    .slice(0, MAX_BLOCKS);
  return {
    version: 1,
    theme: {
      accent: color(t.accent, DEFAULT_THEME.accent),
      background: color(t.background, DEFAULT_THEME.background),
      surface: color(t.surface, DEFAULT_THEME.surface),
      ink: color(t.ink, DEFAULT_THEME.ink),
      font: t.font === 'serif' ? 'serif' : 'sans',
    },
    blocks,
  };
}

/* ── the renderer (email-client HTML: tables, inline styles, 600px) ──────── */

const FONT = { serif: "Georgia,'Times New Roman',serif", sans: "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" };

function renderBlock(b: Block, th: EmailTheme, rtl: boolean): string {
  const start = rtl ? 'right' : 'left';
  const al = (a: Align) => (a === 'left' ? start : a === 'right' ? (rtl ? 'left' : 'right') : 'center');
  const font = FONT[th.font];
  switch (b.type) {
    case 'header':
      return `<tr><td style="background:${th.ink};padding:22px 32px;text-align:${start}"><div style="font-family:${FONT.serif};font-size:20px;letter-spacing:4px;color:${th.accent};font-weight:700">${escapeHtml(b.brand)}</div>${b.tagline ? `<div style="font-family:${font};font-size:12px;color:#D9DEE8;margin-top:4px">${escapeHtml(b.tagline)}</div>` : ''}</td></tr>`;
    case 'heading': {
      const size = b.level === 1 ? 26 : 19;
      return b.text ? `<tr><td style="padding:24px 32px 6px;text-align:${al(b.align)}"><h${b.level} style="margin:0;font-family:${FONT[th.font === 'serif' ? 'serif' : 'sans']};font-size:${size}px;line-height:1.3;color:${th.ink};font-weight:700">${escapeHtml(b.text)}</h${b.level}></td></tr>` : '';
    }
    case 'text':
      return b.html ? `<tr><td style="padding:10px 32px;text-align:${al(b.align)};font-family:${font};font-size:15px;line-height:1.65;color:#333a46">${sanitizeInline(b.html).replace(/<a href=/g, `<a style="color:${th.accent}" href=`)}</td></tr>` : '';
    case 'image': {
      if (!b.src) return '';
      const img = `<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}" width="${Math.round(536 * b.width / 100)}" style="display:inline-block;width:${b.width}%;max-width:100%;height:auto;border:0;border-radius:10px">`;
      const linked = b.href ? `<a href="${escapeHtml(b.href)}">${img}</a>` : img;
      return `<tr><td style="padding:12px 32px;text-align:${al(b.align)}">${linked}${b.caption ? `<div style="font-family:${font};font-size:12px;color:#6b7280;margin-top:6px;text-align:${al(b.align)}">${escapeHtml(b.caption)}</div>` : ''}</td></tr>`;
    }
    case 'gallery': {
      if (!b.images.length) return '';
      const w = Math.floor(100 / b.images.length);
      const cells = b.images.map((i) => `<td class="hm-col" width="${w}%" style="padding:4px;vertical-align:top"><img src="${escapeHtml(i.src)}" alt="${escapeHtml(i.alt)}" style="display:block;width:100%;height:auto;border:0;border-radius:8px"></td>`).join('');
      return `<tr><td style="padding:10px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
    }
    case 'button':
      return b.label && b.href ? `<tr><td style="padding:18px 32px;text-align:${al(b.align)}"><a href="${escapeHtml(b.href)}" style="display:inline-block;background:${th.accent};color:#14110a;font-family:${font};font-size:15px;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px">${escapeHtml(b.label)}</a></td></tr>` : '';
    case 'facts': {
      if (!b.items.length) return '';
      const rows = b.items.map((i) => `<tr><td style="padding:7px 0;font-family:${font};font-size:13px;color:#6b7280;border-bottom:1px solid #eee">${escapeHtml(i.label)}</td><td style="padding:7px 0;font-family:${font};font-size:14px;color:${th.ink};font-weight:600;text-align:${rtl ? 'left' : 'right'};border-bottom:1px solid #eee">${escapeHtml(i.value)}</td></tr>`).join('');
      return `<tr><td style="padding:10px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
    }
    case 'divider':
      return `<tr><td style="padding:12px 32px"><div style="height:1px;background:${th.accent};opacity:.45"></div></td></tr>`;
    case 'spacer':
      return `<tr><td style="height:${b.size}px;line-height:${b.size}px;font-size:0">&nbsp;</td></tr>`;
    case 'footer':
      return b.text ? `<tr><td style="padding:20px 32px 26px;font-family:${font};font-size:12px;line-height:1.6;color:#6b7280;text-align:center;white-space:pre-line">${escapeHtml(b.text)}</td></tr>` : '';
  }
}

export function renderEmailHtml(design: EmailDesign, opts: { subject?: string; preheader?: string; dir?: 'ltr' | 'rtl'; lang?: string } = {}): string {
  const d = sanitizeDesign(design);
  const th = d.theme;
  const rtl = opts.dir === 'rtl';
  const body = d.blocks.map((b) => renderBlock(b, th, rtl)).join('');
  const pre = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</div>` : '';
  return `<!doctype html><html lang="${escapeHtml(opts.lang ?? 'en')}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.subject ?? '')}</title><style>@media (max-width:620px){.hm-wrap{width:100%!important}.hm-col{display:block!important;width:100%!important}}</style></head><body style="margin:0;padding:0;background:${th.background}">${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${th.background}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" class="hm-wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${th.surface};border-radius:16px;overflow:hidden">${body}</table></td></tr></table></body></html>`;
}

/** The plain-text alternative outreach-send attaches beside the HTML. */
export function renderEmailText(design: EmailDesign): string {
  const d = sanitizeDesign(design);
  const lines: string[] = [];
  for (const b of d.blocks) {
    if (b.type === 'header') lines.push(b.brand + (b.tagline ? `\n${b.tagline}` : ''));
    else if (b.type === 'heading' && b.text) lines.push(b.text);
    else if (b.type === 'text' && b.html) lines.push(inlineToText(b.html));
    else if (b.type === 'button' && b.label && b.href) lines.push(`${b.label}: ${b.href}`);
    else if (b.type === 'facts' && b.items.length) lines.push(b.items.map((i) => `${i.label}: ${i.value}`).join('\n'));
    else if (b.type === 'footer' && b.text) lines.push(b.text);
  }
  return lines.join('\n\n').trim();
}

/** Merge fields outreach-send fills per recipient: {{first_name}} / {{name}}, each with an optional |fallback. */
export const MERGE_FIELD_RE = /\{\{\s*(first_name|name)\s*(?:\|([^}]{0,40}))?\}\}/g;
export function applyMergeFields(text: string, fullName: string | null, escape: boolean): string {
  return text.replace(MERGE_FIELD_RE, (_m, field: string, fallback?: string) => {
    const name = (fullName ?? '').trim();
    const value = name ? (field === 'first_name' ? name.split(/\s+/)[0] : name) : (fallback ?? '').trim();
    return escape ? escapeHtml(value) : value;
  });
}

/** Everything a send would be refused for, before the customer is asked to confirm. */
export function designProblems(design: EmailDesign, subject: string): string[] {
  const d = sanitizeDesign(design);
  const out: string[] = [];
  if (!subject.trim()) out.push('NO_SUBJECT');
  if (!d.blocks.some((b) => (b.type === 'text' && inlineToText(b.html).trim()) || (b.type === 'heading' && b.text.trim()))) out.push('NO_CONTENT');
  if (d.blocks.some((b) => b.type === 'image' && !b.src)) out.push('IMAGE_WITHOUT_SOURCE');
  if (d.blocks.some((b) => b.type === 'button' && (!b.label.trim() || !b.href))) out.push('BUTTON_INCOMPLETE');
  return out;
}
