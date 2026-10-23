// EMAIL DESIGNER — the document. Owner brief §5.
//
// A campaign's design is DATA, never HTML: an ordered list of typed blocks with bounded,
// validated properties. The browser edits it; the SERVER normalizes it (normalizeDoc) and
// renders it (render.ts) — the HTML a recipient receives is never taken from the client. That
// is what makes "sanitize unsafe markup / no executable scripts" a property of the format
// rather than a filter: there is no field a script could live in.
//
// Text supports a tiny, safe inline syntax: **bold**, *italic*, [label](https://…) and
// merge fields {{first_name|fallback}} / {{name|fallback}}. Newlines are line breaks.

export const DOC_VERSION = 1 as const;

export type Align = 'left' | 'center' | 'right';
export interface Pad { t: number; r: number; b: number; l: number }

interface BaseBlock {
  id: string;
  background?: string | null;
  padding?: Pad;
  borderWidth?: number;
  borderColor?: string | null;
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
}

export interface HeadingBlock extends BaseBlock { type: 'heading'; text: string; level: 1 | 2 | 3; align: Align; color?: string | null; fontSize?: number; fontWeight?: number; fontFamily?: FontKey }
export interface TextBlock extends BaseBlock { type: 'text'; text: string; align: Align; color?: string | null; fontSize?: number; lineHeight?: number; fontFamily?: FontKey; fontWeight?: number }
export interface ImageBlock extends BaseBlock { type: 'image'; src: string; alt: string; href?: string | null; width: number; align: Align; radius?: number }
export interface ButtonBlock extends BaseBlock { type: 'button'; label: string; href: string; align: Align; buttonColor: string; textColor: string; radius: number; fullWidth?: boolean; fontSize?: number; fontWeight?: number }
export interface DividerBlock extends BaseBlock { type: 'divider'; color: string; thickness: number }
export interface SpacerBlock extends BaseBlock { type: 'spacer'; height: number }
export interface LogoBlock extends BaseBlock { type: 'logo'; src: string; alt: string; width: number; href?: string | null; align: Align }
export interface SocialBlock extends BaseBlock { type: 'social'; links: Array<{ network: SocialNetwork; url: string }>; align: Align }
export interface FooterBlock extends BaseBlock { type: 'footer'; text: string; align: Align; color?: string | null }
export interface ContactBlock extends BaseBlock { type: 'contact'; name: string; email: string; phone: string; address: string; align: Align }
export interface UnsubscribeBlock extends BaseBlock { type: 'unsubscribe'; text: string; align: Align }
export type LeafBlock = HeadingBlock | TextBlock | ImageBlock | ButtonBlock | DividerBlock | SpacerBlock | LogoBlock | SocialBlock | FooterBlock | ContactBlock | UnsubscribeBlock;
export interface ColumnsBlock extends BaseBlock { type: 'columns'; columns: [LeafBlock[], LeafBlock[]]; ratio: '50-50' | '40-60' | '60-40'; stackOnMobile: boolean; gap: number }
export type Block = LeafBlock | ColumnsBlock;
export type BlockType = Block['type'];

export type FontKey = 'system' | 'serif' | 'georgia' | 'helvetica' | 'mono';
export type SocialNetwork = 'facebook' | 'instagram' | 'linkedin' | 'x' | 'youtube' | 'tiktok' | 'telegram' | 'whatsapp' | 'website';

export interface Theme {
  canvas: string;
  card: string;
  text: string;
  muted: string;
  accent: string;
  link: string;
  fontFamily: FontKey;
  width: number;
  radius: number;
}

export interface EmailDoc { version: typeof DOC_VERSION; theme: Theme; blocks: Block[] }

export const FONT_STACKS: Record<FontKey, string> = {
  system: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans Georgian', 'Noto Sans Arabic', 'Noto Sans Hebrew', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Noto Serif Georgian', serif",
  georgia: "Georgia, 'Noto Serif Georgian', serif",
  helvetica: "Helvetica, Arial, 'Noto Sans Georgian', sans-serif",
  mono: "'SFMono-Regular', Menlo, Consolas, monospace",
};
export const FONT_KEYS = Object.keys(FONT_STACKS) as FontKey[];
export const SOCIAL_NETWORKS: SocialNetwork[] = ['facebook', 'instagram', 'linkedin', 'x', 'youtube', 'tiktok', 'telegram', 'whatsapp', 'website'];

export const DEFAULT_THEME: Theme = {
  canvas: '#F6F3EE', card: '#FFFFFF', text: '#1F2430', muted: '#6B7280', accent: '#C9973A', link: '#8A6420',
  fontFamily: 'system', width: 600, radius: 14,
};

export const LIMITS = { blocks: 60, textChars: 5000, headingChars: 300, labelChars: 80, urlChars: 2000, altChars: 200, socialLinks: 9 } as const;

/* ── normalization: the server's only way in ─────────────────────────────────────────────── */

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, d: string | null): string | null => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toUpperCase() : d);
const num = (v: unknown, min: number, max: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '');
const align = (v: unknown, d: Align = 'left'): Align => (v === 'center' || v === 'right' || v === 'left' ? v : d);
const font = (v: unknown): FontKey | undefined => (FONT_KEYS.includes(v as FontKey) ? (v as FontKey) : undefined);
/** https or a merge-field placeholder for links; https only for images. */
export const safeLinkUrl = (v: unknown): string => {
  const s = str(v, LIMITS.urlChars).trim();
  return /^https:\/\/[^\s<>"']+$/i.test(s) || /^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(s) || /^tel:\+?[0-9 ()-]{5,20}$/.test(s) ? s : '';
};
export const safeImageUrl = (v: unknown): string => {
  const s = str(v, LIMITS.urlChars).trim();
  return /^https:\/\/[^\s<>"']+$/i.test(s) ? s : '';
};
const pad = (v: unknown, d: Pad): Pad => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { t: num(o.t, 0, 80, d.t), r: num(o.r, 0, 80, d.r), b: num(o.b, 0, 80, d.b), l: num(o.l, 0, 80, d.l) };
};
const DEFAULT_PAD: Pad = { t: 8, r: 32, b: 8, l: 32 };
let seq = 0;
export const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const id = (v: unknown) => (typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v) ? v : newId());

function base(o: Record<string, unknown>): BaseBlock {
  return {
    id: id(o.id),
    background: color(o.background, null),
    padding: pad(o.padding, DEFAULT_PAD),
    borderWidth: num(o.borderWidth, 0, 8, 0),
    borderColor: color(o.borderColor, null),
    hideOnMobile: o.hideOnMobile === true,
    hideOnDesktop: o.hideOnDesktop === true,
  };
}

function leaf(raw: unknown): LeafBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const b = base(o);
  switch (o.type) {
    case 'heading': return { ...b, type: 'heading', text: str(o.text, LIMITS.headingChars), level: ([1, 2, 3].includes(Number(o.level)) ? Number(o.level) : 1) as 1 | 2 | 3, align: align(o.align), color: color(o.color, null), fontSize: o.fontSize == null ? undefined : num(o.fontSize, 14, 48, 26), fontWeight: o.fontWeight == null ? undefined : num(o.fontWeight, 300, 900, 700), fontFamily: font(o.fontFamily) };
    case 'text': return { ...b, type: 'text', text: str(o.text, LIMITS.textChars), align: align(o.align), color: color(o.color, null), fontSize: o.fontSize == null ? undefined : num(o.fontSize, 11, 28, 16), lineHeight: o.lineHeight == null ? undefined : Math.min(2.2, Math.max(1, Number(o.lineHeight) || 1.6)), fontFamily: font(o.fontFamily), fontWeight: o.fontWeight == null ? undefined : num(o.fontWeight, 300, 900, 400) };
    case 'image': return { ...b, type: 'image', src: safeImageUrl(o.src), alt: str(o.alt, LIMITS.altChars), href: safeLinkUrl(o.href) || null, width: num(o.width, 40, 600, 536), align: align(o.align, 'center'), radius: num(o.radius, 0, 40, 8) };
    case 'button': return { ...b, type: 'button', label: str(o.label, LIMITS.labelChars), href: safeLinkUrl(o.href), align: align(o.align), buttonColor: color(o.buttonColor, DEFAULT_THEME.accent) as string, textColor: color(o.textColor, '#0C1119') as string, radius: num(o.radius, 0, 40, 10), fullWidth: o.fullWidth === true, fontSize: o.fontSize == null ? undefined : num(o.fontSize, 12, 22, 15), fontWeight: o.fontWeight == null ? undefined : num(o.fontWeight, 400, 900, 700) };
    case 'divider': return { ...b, type: 'divider', color: color(o.color, '#E7E1D6') as string, thickness: num(o.thickness, 1, 6, 1) };
    case 'spacer': return { ...b, type: 'spacer', height: num(o.height, 4, 120, 24) };
    case 'logo': return { ...b, type: 'logo', src: safeImageUrl(o.src), alt: str(o.alt, LIMITS.altChars), width: num(o.width, 40, 300, 140), href: safeLinkUrl(o.href) || null, align: align(o.align, 'center') };
    case 'social': {
      const links = (Array.isArray(o.links) ? o.links : []).slice(0, LIMITS.socialLinks).map((l) => {
        const r = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
        return { network: (SOCIAL_NETWORKS.includes(r.network as SocialNetwork) ? r.network : 'website') as SocialNetwork, url: safeLinkUrl(r.url) };
      }).filter((l) => l.url);
      return { ...b, type: 'social', links, align: align(o.align, 'center') };
    }
    case 'footer': return { ...b, type: 'footer', text: str(o.text, 1000), align: align(o.align, 'center'), color: color(o.color, null) };
    case 'contact': return { ...b, type: 'contact', name: str(o.name, 120), email: str(o.email, 254), phone: str(o.phone, 40), address: str(o.address, 300), align: align(o.align) };
    case 'unsubscribe': return { ...b, type: 'unsubscribe', text: str(o.text, 200), align: align(o.align, 'center') };
    default: return null;
  }
}

function block(raw: unknown): Block | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (o.type === 'columns') {
    const cols = Array.isArray(o.columns) ? o.columns : [];
    const col = (c: unknown) => (Array.isArray(c) ? c.map(leaf).filter((x): x is LeafBlock => x != null).slice(0, 8) : []);
    return {
      ...base(o), type: 'columns', columns: [col(cols[0]), col(cols[1])],
      ratio: (['50-50', '40-60', '60-40'].includes(o.ratio as string) ? o.ratio : '50-50') as ColumnsBlock['ratio'],
      stackOnMobile: o.stackOnMobile !== false, gap: num(o.gap, 0, 40, 16),
    };
  }
  return leaf(raw);
}

export function normalizeTheme(raw: unknown): Theme {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    canvas: color(o.canvas, DEFAULT_THEME.canvas) as string, card: color(o.card, DEFAULT_THEME.card) as string,
    text: color(o.text, DEFAULT_THEME.text) as string, muted: color(o.muted, DEFAULT_THEME.muted) as string,
    accent: color(o.accent, DEFAULT_THEME.accent) as string, link: color(o.link, DEFAULT_THEME.link) as string,
    fontFamily: font(o.fontFamily) ?? DEFAULT_THEME.fontFamily, width: num(o.width, 480, 680, 600), radius: num(o.radius, 0, 28, 14),
  };
}

/** Anything → a valid document. Unknown blocks are dropped, every value is bounded. */
export function normalizeDoc(raw: unknown): EmailDoc {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const blocks = (Array.isArray(o.blocks) ? o.blocks : []).map(block).filter((b): b is Block => b != null).slice(0, LIMITS.blocks);
  return { version: DOC_VERSION, theme: normalizeTheme(o.theme), blocks };
}

/* ── factories for the designer palette ──────────────────────────────────────────────────── */

export function createBlock(type: BlockType): Block {
  const b = { id: newId(), padding: { ...DEFAULT_PAD } };
  switch (type) {
    case 'heading': return { ...b, type, text: '', level: 1, align: 'left' };
    case 'text': return { ...b, type, text: '', align: 'left' };
    case 'image': return { ...b, type, src: '', alt: '', width: 536, align: 'center', radius: 8 };
    case 'button': return { ...b, type, label: '', href: '', align: 'left', buttonColor: DEFAULT_THEME.accent, textColor: '#0C1119', radius: 10 };
    case 'divider': return { ...b, type, color: '#E7E1D6', thickness: 1 };
    case 'spacer': return { ...b, type, height: 24, padding: { t: 0, r: 0, b: 0, l: 0 } };
    case 'logo': return { ...b, type, src: '', alt: '', width: 140, align: 'center' };
    case 'social': return { ...b, type, links: [], align: 'center' };
    case 'footer': return { ...b, type, text: '', align: 'center' };
    case 'contact': return { ...b, type, name: '', email: '', phone: '', address: '', align: 'left' };
    case 'unsubscribe': return { ...b, type, text: '', align: 'center' };
    case 'columns': return { ...b, type, columns: [[createBlock('text') as LeafBlock], [createBlock('text') as LeafBlock]], ratio: '50-50', stackOnMobile: true, gap: 16 };
  }
}

/** A deep copy with fresh ids (duplicate, reusable sections). */
export function cloneBlock<T extends Block>(b: T): T {
  const c = JSON.parse(JSON.stringify(b)) as T;
  c.id = newId();
  if (c.type === 'columns') (c as ColumnsBlock).columns = (c as ColumnsBlock).columns.map((col) => col.map((x) => ({ ...x, id: newId() }))) as ColumnsBlock['columns'];
  return c;
}

export function emptyDoc(): EmailDoc {
  return { version: DOC_VERSION, theme: { ...DEFAULT_THEME }, blocks: [] };
}
