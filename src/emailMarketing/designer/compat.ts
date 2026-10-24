// EMAIL DESIGNER — mail-client compatibility analysis of a design.
//
// What the editor can know without sending: properties of the document and of the HTML the
// renderer produces that some mail apps are known to treat differently — background images
// (Outlook for Windows ignores them), custom HTML, hide-on-desktop content (needs the <style>
// block some apps strip), columns that do not stack, rounded corners (Outlook squares them),
// hover colours, a body past Gmail's 102 KB clipping point, small or low-contrast text, an
// email that is mostly images. Each warning names its block and, where one exists, an
// email-safe alternative the author can apply in one click. This is guidance from the format,
// not a rendering test: the editor never claims an email "renders correctly" from it.

import { type Block, type EmailDoc, normalizeDoc, walkBlocks } from './document.ts';
import { renderDesignBody } from './render.ts';
import { updateBlock } from './tree.ts';

export type CompatCode =
  | 'BG_IMAGE_OUTLOOK' | 'CUSTOM_HTML' | 'HIDE_DESKTOP_STYLE' | 'COLUMNS_NO_STACK' | 'RADIUS_OUTLOOK' | 'HOVER_LIMITED'
  | 'GMAIL_CLIP' | 'TEXT_SMALL' | 'LOW_CONTRAST' | 'IMAGE_HEAVY' | 'WIDE_LAYOUT';

export interface CompatWarning {
  code: CompatCode;
  severity: 'info' | 'warn';
  blockId?: string;
  /** Numbers for the message ({{kb}}, {{ratio}}…). */
  vars?: Record<string, string | number>;
  /** The email-safe alternative, when one exists. */
  fix?: (doc: EmailDoc) => EmailDoc;
}

/** Gmail clips a message body past ~102 KB ("[Message clipped]"); the wrapper adds a few KB. */
export const GMAIL_CLIP_BYTES = 102 * 1024;
const WRAPPER_BYTES = 6 * 1024;

const hex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h: string) => {
  const [r, g, b] = hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

const patch = (id: string, p: Record<string, unknown>) => (doc: EmailDoc): EmailDoc =>
  normalizeDoc({ ...doc, blocks: updateBlock(doc.blocks, id, (b) => ({ ...b, ...p } as Block)) });

export function analyzeCompat(input: unknown): CompatWarning[] {
  const doc = normalizeDoc(input);
  const all = walkBlocks(doc.blocks).filter((b) => !b.hidden);
  const out: CompatWarning[] = [];
  let radiusNoted = false;

  for (const b of all) {
    if (b.type === 'section' && b.bgImage) out.push({ code: 'BG_IMAGE_OUTLOOK', severity: 'warn', blockId: b.id, fix: patch(b.id, { bgImage: '' }) });
    if (b.type === 'html' && b.html) out.push({ code: 'CUSTOM_HTML', severity: 'warn', blockId: b.id });
    if (b.hideOnDesktop) out.push({ code: 'HIDE_DESKTOP_STYLE', severity: 'warn', blockId: b.id, fix: patch(b.id, { hideOnDesktop: false }) });
    if (b.type === 'columns' && !b.stackOnMobile) out.push({ code: 'COLUMNS_NO_STACK', severity: 'warn', blockId: b.id, fix: patch(b.id, { stackOnMobile: true }) });
    if (b.type === 'button' && b.hoverColor) out.push({ code: 'HOVER_LIMITED', severity: 'info', blockId: b.id });
    if (!radiusNoted && ((b.type === 'section' && b.radius > 0) || (b.type === 'button' && b.radius > 0) || (b.type === 'card' && b.radius > 0))) {
      radiusNoted = true;
      out.push({ code: 'RADIUS_OUTLOOK', severity: 'info', blockId: b.id });
    }
    if ((b.type === 'text' && (b.fontSize ?? 16) < 13) || (b.type === 'heading' && (b.fontSize ?? 18) < 14)) {
      out.push({ code: 'TEXT_SMALL', severity: 'warn', blockId: b.id, vars: { px: b.fontSize ?? 0 }, fix: patch(b.id, { fontSize: b.type === 'text' ? 14 : 16 }) });
    }
    if (b.type === 'text' || b.type === 'heading') {
      const fg = b.color ?? doc.theme.text;
      const bg = b.background ?? doc.theme.card;
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) out.push({ code: 'LOW_CONTRAST', severity: 'warn', blockId: b.id, vars: { ratio }, fix: patch(b.id, { color: contrast(doc.theme.text, bg) >= 4.5 ? doc.theme.text : (lum(bg) > 0.4 ? '#1F2430' : '#FFFFFF') }) });
    }
  }

  if (doc.theme.width > 640) out.push({ code: 'WIDE_LAYOUT', severity: 'info', vars: { px: doc.theme.width }, fix: (d) => normalizeDoc({ ...d, theme: { ...d.theme, width: 600 } }) });

  /* Mostly images and little text: some filters score image-only mail as spam, and blocked images leave it empty. */
  const images = all.filter((b) => (b.type === 'image' && b.src) || (b.type === 'gallery') || (b.type === 'video' && b.thumbSrc) || (b.type === 'banner' && b.imageSrc)).length;
  const rendered = renderDesignBody(doc);
  const words = rendered.text.split(/\s+/).filter((w) => w.length > 1).length;
  if (images >= 2 && words < 40) out.push({ code: 'IMAGE_HEAVY', severity: 'warn', vars: { images, words } });

  const bytes = new TextEncoder().encode(rendered.html).length + WRAPPER_BYTES;
  if (bytes > GMAIL_CLIP_BYTES * 0.85) out.push({ code: 'GMAIL_CLIP', severity: bytes > GMAIL_CLIP_BYTES ? 'warn' : 'info', vars: { kb: Math.round(bytes / 1024) } });
  return out;
}

/** Apply every available email-safe alternative at once. */
export function applyAllFixes(input: unknown): EmailDoc {
  let doc = normalizeDoc(input);
  for (const w of analyzeCompat(doc)) if (w.fix) doc = w.fix(doc);
  return doc;
}
