// HOMATCH EMAIL STUDIO — the block model.
//
// An email is an ordered list of blocks. Text blocks carry the seller's words;
// photo blocks carry INDEXES into the listing's own photo list (never a URL), so a
// campaign can only ever show the listing's real images and the server, which
// resolves those indexes, decides what an image address is. The call-to-action has
// a label and no link: it always points at the listing, server-side.
//
// Footer and unsubscribe are locked to the end and cannot be removed — every
// campaign email carries the reason it was sent and a working unsubscribe link.

import {
  TEMPLATE_COPY, type EmailLang, type TemplateId, asEmailLang,
} from './templates.ts';

export type BlockType =
  | 'logo' | 'headline' | 'text' | 'hero' | 'gallery' | 'specs' | 'price'
  | 'location' | 'cta' | 'divider' | 'contact' | 'footer' | 'unsubscribe';

export const BLOCK_TYPES: readonly BlockType[] = [
  'logo', 'headline', 'text', 'hero', 'gallery', 'specs', 'price',
  'location', 'cta', 'divider', 'contact', 'footer', 'unsubscribe',
];

/** Blocks an owner may add from the editor (footer/unsubscribe are always there). */
export const ADDABLE_BLOCKS: readonly BlockType[] = [
  'logo', 'headline', 'text', 'hero', 'gallery', 'specs', 'price', 'location', 'cta', 'divider', 'contact',
];

export const LOCKED_BLOCKS: readonly BlockType[] = ['footer', 'unsubscribe'];

export interface EmailBlock {
  id: string;
  type: BlockType;
  /** headline / text / cta label / contact note. */
  text?: string;
  /** hero: index into the listing's photos. */
  image?: number;
  /** gallery: up to four indexes into the listing's photos. */
  images?: number[];
}

export interface EmailContent {
  subject: string;
  preheader: string;
  blocks: EmailBlock[];
}

export const LIMITS = {
  subject: 150,
  preheader: 200,
  headline: 160,
  text: 2000,
  cta: 40,
  contact: 500,
  blocks: 24,
  gallery: 4,
} as const;

/** The default arrangement of each template. */
export const TEMPLATE_LAYOUT: Record<TemplateId, BlockType[]> = {
  PROPERTY_INTRODUCTION: ['logo', 'hero', 'headline', 'text', 'price', 'specs', 'location', 'cta', 'gallery', 'footer', 'unsubscribe'],
  MODERN_RESIDENCE: ['logo', 'hero', 'headline', 'text', 'specs', 'price', 'gallery', 'location', 'cta', 'footer', 'unsubscribe'],
  PREMIUM_PROPERTY: ['logo', 'hero', 'headline', 'text', 'divider', 'price', 'specs', 'gallery', 'location', 'cta', 'footer', 'unsubscribe'],
  PERSONAL_FOLLOW_UP: ['headline', 'text', 'hero', 'price', 'specs', 'location', 'cta', 'contact', 'footer', 'unsubscribe'],
};

const ID_RE = /^[a-z0-9-]{1,40}$/;

function isBlockType(value: unknown): value is BlockType {
  return typeof value === 'string' && (BLOCK_TYPES as readonly string[]).includes(value);
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Control characters (other than newline/tab) never belong in an email.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

function textLimit(type: BlockType): number {
  if (type === 'headline') return LIMITS.headline;
  if (type === 'cta') return LIMITS.cta;
  if (type === 'contact') return LIMITS.contact;
  return LIMITS.text;
}

function validIndex(value: unknown, imageCount: number | null): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
  if (imageCount !== null && value >= imageCount) return undefined;
  return value;
}

export function newBlockId(seed: string | number): string {
  return `b-${String(seed).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || '0'}`;
}

/** A fresh block of a type, with the template's default copy where it has one. */
export function createBlock(type: BlockType, id: string, templateId: TemplateId, lang: EmailLang): EmailBlock {
  const copy = TEMPLATE_COPY[templateId][lang];
  switch (type) {
    case 'headline': return { id, type, text: copy.headline };
    case 'text': return { id, type, text: copy.body };
    case 'cta': return { id, type, text: copy.cta };
    case 'hero': return { id, type, image: 0 };
    case 'gallery': return { id, type, images: [1, 2, 3] };
    case 'contact': return { id, type, text: '' };
    default: return { id, type };
  }
}

/** The template's default email, in one language. */
export function defaultContent(templateId: TemplateId, langInput: string): EmailContent {
  const lang = asEmailLang(langInput);
  const copy = TEMPLATE_COPY[templateId][lang];
  return {
    subject: copy.headline,
    preheader: copy.body.slice(0, LIMITS.preheader),
    blocks: TEMPLATE_LAYOUT[templateId].map((type, i) => createBlock(type, `b-${type}-${i}`, templateId, lang)),
  };
}

/**
 * Whatever arrived (a saved draft, a request body) as a valid email. Unknown block
 * types are dropped, text is clipped, photo indexes outside the listing's photos are
 * removed (imageCount null = not known yet: keep any non-negative index), and the
 * footer + unsubscribe are guaranteed exactly once, last.
 */
export function normalizeContent(raw: unknown, imageCount: number | null = null): EmailContent {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  const seen = new Set<string>();
  const blocks: EmailBlock[] = [];
  for (let i = 0; i < rawBlocks.length && blocks.length < LIMITS.blocks; i++) {
    const b = rawBlocks[i] as Record<string, unknown> | null;
    if (!b || typeof b !== 'object' || !isBlockType(b.type)) continue;
    const type = b.type;
    if ((LOCKED_BLOCKS as readonly string[]).includes(type)) continue; // re-added below
    let id = typeof b.id === 'string' && ID_RE.test(b.id) ? b.id : `b-${i}`;
    while (seen.has(id)) id = `${id}-x`.slice(0, 40);
    seen.add(id);
    const block: EmailBlock = { id, type };
    if (type === 'headline' || type === 'text' || type === 'cta' || type === 'contact') {
      block.text = clip(b.text, textLimit(type));
    }
    if (type === 'hero') {
      const idx = validIndex(b.image, imageCount);
      if (idx !== undefined) block.image = idx;
    }
    if (type === 'gallery') {
      const list = Array.isArray(b.images) ? b.images : [];
      const unique: number[] = [];
      for (const v of list) {
        const idx = validIndex(v, imageCount);
        if (idx !== undefined && !unique.includes(idx)) unique.push(idx);
        if (unique.length >= LIMITS.gallery) break;
      }
      block.images = unique;
    }
    blocks.push(block);
  }
  blocks.push({ id: 'b-footer', type: 'footer' }, { id: 'b-unsubscribe', type: 'unsubscribe' });
  return {
    subject: clip(obj.subject, LIMITS.subject).replace(/[\r\n]+/g, ' ').trim(),
    preheader: clip(obj.preheader, LIMITS.preheader).replace(/[\r\n]+/g, ' ').trim(),
    blocks,
  };
}

function isLocked(block: EmailBlock): boolean {
  return (LOCKED_BLOCKS as readonly string[]).includes(block.type);
}

/** Move one block up (delta -1) or down (+1). Locked blocks never move, and nothing moves past them. */
export function moveBlock(blocks: EmailBlock[], index: number, delta: -1 | 1): EmailBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
  if (isLocked(blocks[index]) || isLocked(blocks[target])) return blocks;
  const next = blocks.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Move a block from one position to another (drag and drop). Same locking rules. */
export function reorderBlock(blocks: EmailBlock[], from: number, to: number): EmailBlock[] {
  if (from === to || from < 0 || from >= blocks.length || to < 0 || to >= blocks.length) return blocks;
  if (isLocked(blocks[from])) return blocks;
  const firstLocked = blocks.findIndex(isLocked);
  const limit = firstLocked === -1 ? blocks.length - 1 : firstLocked - 1;
  const dest = Math.min(to, limit);
  const next = blocks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(dest, 0, moved);
  return next;
}

export function removeBlock(blocks: EmailBlock[], id: string): EmailBlock[] {
  return blocks.filter((b) => b.id !== id || isLocked(b));
}

/** Insert a block just before the locked footer. */
export function addBlock(blocks: EmailBlock[], block: EmailBlock): EmailBlock[] {
  if (blocks.length >= LIMITS.blocks || isLocked(block)) return blocks;
  const firstLocked = blocks.findIndex(isLocked);
  const at = firstLocked === -1 ? blocks.length : firstLocked;
  const next = blocks.slice();
  next.splice(at, 0, block);
  return next;
}

export function updateBlock(blocks: EmailBlock[], id: string, patch: Partial<EmailBlock>): EmailBlock[] {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch, id: b.id, type: b.type } : b));
}

/**
 * Change template, keeping the owner's work. The block list, its order, every
 * photo choice and every edited sentence stay as they are; only text that is
 * still the OLD template's untouched default copy becomes the new template's
 * default. The look (theme) is the template's and changes with it.
 */
export function switchTemplate(content: EmailContent, from: TemplateId, to: TemplateId, langInput: string): EmailContent {
  if (from === to) return content;
  const lang = asEmailLang(langInput);
  const oldCopy = TEMPLATE_COPY[from][lang];
  const newCopy = TEMPLATE_COPY[to][lang];
  const swap = (text: string | undefined, oldDefault: string, newDefault: string) =>
    (text ?? '').trim() === oldDefault.trim() ? newDefault : text;
  return {
    subject: swap(content.subject, oldCopy.headline, newCopy.headline) ?? '',
    preheader: swap(content.preheader, oldCopy.body.slice(0, LIMITS.preheader), newCopy.body.slice(0, LIMITS.preheader)) ?? '',
    blocks: content.blocks.map((b) => {
      if (b.type === 'headline') return { ...b, text: swap(b.text, oldCopy.headline, newCopy.headline) };
      if (b.type === 'text') return { ...b, text: swap(b.text, oldCopy.body, newCopy.body) };
      if (b.type === 'cta') return { ...b, text: swap(b.text, oldCopy.cta, newCopy.cta) };
      return b;
    }),
  };
}

/** Replace the default copy of headline/text/cta with AI-drafted copy (first block of each type). */
export function applyDraftCopy(content: EmailContent, draft: Partial<{ subject: string; preheader: string; headline: string; body: string; cta: string }>): EmailContent {
  const done = new Set<string>();
  const pick = (type: BlockType, value: string | undefined, max: number) => (b: EmailBlock): EmailBlock => {
    if (b.type !== type || done.has(type) || !value) return b;
    done.add(type);
    return { ...b, text: value.slice(0, max) };
  };
  let blocks = content.blocks;
  blocks = blocks.map(pick('headline', draft.headline, LIMITS.headline));
  blocks = blocks.map(pick('text', draft.body, LIMITS.text));
  blocks = blocks.map(pick('cta', draft.cta, LIMITS.cta));
  return {
    subject: draft.subject ? draft.subject.slice(0, LIMITS.subject) : content.subject,
    preheader: draft.preheader ? draft.preheader.slice(0, LIMITS.preheader) : content.preheader,
    blocks,
  };
}

/**
 * Change the email's language, keeping the owner's work: only text that is still
 * the template's untouched default in the OLD language becomes the default in the
 * new one.
 */
export function relocalizeContent(content: EmailContent, templateId: TemplateId, fromLang: string, toLang: string): EmailContent {
  const from = TEMPLATE_COPY[templateId][asEmailLang(fromLang)];
  const to = TEMPLATE_COPY[templateId][asEmailLang(toLang)];
  if (from === to) return content;
  const swap = (text: string | undefined, a: string, b: string) => ((text ?? '').trim() === a.trim() ? b : text);
  return {
    subject: swap(content.subject, from.headline, to.headline) ?? '',
    preheader: swap(content.preheader, from.body.slice(0, LIMITS.preheader), to.body.slice(0, LIMITS.preheader)) ?? '',
    blocks: content.blocks.map((b) => {
      if (b.type === 'headline') return { ...b, text: swap(b.text, from.headline, to.headline) };
      if (b.type === 'text') return { ...b, text: swap(b.text, from.body, to.body) };
      if (b.type === 'cta') return { ...b, text: swap(b.text, from.cta, to.cta) };
      return b;
    }),
  };
}
