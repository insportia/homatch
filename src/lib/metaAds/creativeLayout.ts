// META ADS — HOMATCH CREATIVE TEXT LAYER. Pure: no I/O, no secrets, no model call.
//
// The rule this file exists for: the image model draws the VISUAL ONLY. Every
// customer-facing word of an ad (headline, supporting line, offer, CTA, brand,
// badge) is real Unicode typeset here, by HOMATCH, from the customer's
// structured copy — never pixels a model guessed at. Production showed why: a
// Georgian headline drawn by the image model came back as "Oინ Views" and
// unreadable glyphs.
//
// One implementation, two consumers:
//   composeCreative()  layout → positioned text runs + legibility checks
//   renderCreativeSvg() the ONE serializer. The browser preview shows its SVG
//                       (real, selectable text in the same font files); the
//                       server rasterises the SAME SVG to the PNG Meta receives
//                       (meta-ads-api/composer.ts). Only the font family names
//                       (browser-registered vs the files' own) and the visual's
//                       href differ between the two.
//
// Line breaks, font sizes and every run's x are decided here with HarfBuzz
// advances from the pinned font files (createHarfbuzzMeasurer), so neither
// renderer wraps, picks a font, or resolves bidi on its own: each run is one
// script, one font, one direction, placed at an explicit x.

export const CREATIVE_ENGINE_VERSION = 1;

/* ── Pinned assets (public/creative-engine; the server verifies every hash) ── */

export const CREATIVE_ASSET_BASE = '/creative-engine/';
export type FontKey = 'sans' | 'georgian' | 'arabic' | 'hebrew';
export type Weight = 400 | 700;
export type FontFaceKey = `${FontKey}-${Weight}`;
export const FONT_FILES: Record<FontFaceKey, { file: string; sha256: string }> = {
  'sans-400': { file: 'NotoSans_400Regular.ttf', sha256: 'fe8c022f48d8dd29f17b744d16f9346f4357e16f7d4f7be58b000ae7c291b614' },
  'sans-700': { file: 'NotoSans_700Bold.ttf', sha256: '13a813c49624ae3ba3c5c6e72c5ebffc4b9e1e6ea32f421c04069b037c6ad431' },
  'georgian-400': { file: 'NotoSansGeorgian_400Regular.ttf', sha256: '35b1dc2d78025505b6d4b7977960060fdb0a9a0dfb21c356fe8ca554172e8f00' },
  'georgian-700': { file: 'NotoSansGeorgian_700Bold.ttf', sha256: '4570253cfb7d734286d56ab3ecff6e4ef2cfe9d77c37dc9e739360da89dccc15' },
  'arabic-400': { file: 'NotoSansArabic_400Regular.ttf', sha256: '252629ca0e87b6233851249b8cbf7b43445211a8caf199f1b306a19202251508' },
  'arabic-700': { file: 'NotoSansArabic_700Bold.ttf', sha256: 'a86a704ff8b315082f4859b04c2f8f746f4cefb14553ef10505f143e0d4829d3' },
  'hebrew-400': { file: 'NotoSansHebrew_400Regular.ttf', sha256: 'e0ee753f09733337b9236221018d4bf71fd6d06c87dd76bbc83120514bc55911' },
  'hebrew-700': { file: 'NotoSansHebrew_700Bold.ttf', sha256: '8010b087f33f152e25aef020e68cb5568d6f8deebb6dde8f60d655196e59ebde' },
};
export const ENGINE_FILES = {
  resvg: { file: 'resvg-2.6.2.wasm', sha256: '22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70' },
  harfbuzz: { file: 'harfbuzz-0.3.6.wasm', sha256: 'bd3f56b3b4cddb90c66cabeb5b4b50c15c41d97aabf777cc5d1544d8365e4541' },
} as const;
/** The family names inside the font files (what the server's rasteriser matches). */
export const EXPORT_FAMILY: Record<FontKey, string> = { sans: 'Noto Sans', georgian: 'Noto Sans Georgian', arabic: 'Noto Sans Arabic', hebrew: 'Noto Sans Hebrew' };
/** The browser registers the SAME files under private names, so the app's own web fonts can never stand in. */
export const BROWSER_FAMILY: Record<FontKey, string> = { sans: 'HMC Sans', georgian: 'HMC Georgian', arabic: 'HMC Arabic', hebrew: 'HMC Hebrew' };

/* ── Formats, layouts, themes ─────────────────────────────────────────── */

export const ASPECTS = ['1:1', '4:5', '9:16'] as const;
export type Aspect = (typeof ASPECTS)[number];
export const CANVAS: Record<Aspect, { w: number; h: number }> = { '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 }, '9:16': { w: 1080, h: 1920 } };
/** Stories/Reels: Meta overlays its own UI on the top and bottom ~14% — no text there. */
const STORY_SAFE = 250;

export const LAYOUT_IDS = ['EDITORIAL_BOTTOM', 'EDITORIAL_TOP', 'SPLIT_START', 'OVERLAY_BOTTOM', 'CENTERED_MINIMAL'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export const LAYOUT_ASPECTS: Record<LayoutId, readonly Aspect[]> = {
  EDITORIAL_BOTTOM: ASPECTS, EDITORIAL_TOP: ASPECTS, SPLIT_START: ['1:1', '4:5'], OVERLAY_BOTTOM: ASPECTS, CENTERED_MINIMAL: ASPECTS,
};
/** When the copy does not fit, layouts with more room for text come first. */
const ROOMIEST: readonly LayoutId[] = ['EDITORIAL_BOTTOM', 'EDITORIAL_TOP', 'OVERLAY_BOTTOM', 'CENTERED_MINIMAL', 'SPLIT_START'];

export const THEME_IDS = ['INK', 'PAPER'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
interface Theme { bg: string; text: string; muted: string; accent: string; ctaFill: string; ctaText: string; scrim: string }
export const THEMES: Record<ThemeId, Theme> = {
  INK: { bg: '#0E1626', text: '#FFFFFF', muted: '#C9D1DE', accent: '#E9C46A', ctaFill: '#D4AF37', ctaText: '#14110A', scrim: '#060A12' },
  PAPER: { bg: '#F6F2EA', text: '#14171F', muted: '#3A4150', accent: '#7A5C0E', ctaFill: '#14171F', ctaText: '#F6F2EA', scrim: '#F6F2EA' },
};

/* ── Copy ─────────────────────────────────────────────────────────────── */

export const COPY_FIELDS = ['brand', 'badge', 'headline', 'subheadline', 'offer', 'cta'] as const;
export type CopyField = (typeof COPY_FIELDS)[number];
export type CreativeCopy = Partial<Record<CopyField, string>> & { headline: string };
export const COPY_LIMITS: Record<CopyField, number> = { brand: 32, badge: 24, headline: 90, subheadline: 140, offer: 48, cta: 28 };

/** Exactly what gets typeset: NFC, one space between words, no control or invisible bidi characters. */
export function normalizeCopyText(v: unknown, max = 200): string {
  return String(v ?? '')
    .normalize('NFC')
    // C0/C1 controls and bidi embedding/override/isolate marks: never part of an ad's words.
    .replace(/[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}
export function normalizeCopy(raw: unknown): CreativeCopy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: CreativeCopy = { headline: '' };
  for (const f of COPY_FIELDS) {
    const v = normalizeCopyText(o[f], COPY_LIMITS[f]);
    if (v || f === 'headline') out[f] = v;
  }
  return out;
}

export interface ComposeSpec {
  layout: LayoutId;
  aspect: Aspect;
  theme: ThemeId;
  copy: CreativeCopy;
  /** A shorter approved headline (Creative Intelligence), tried before changing layout. */
  shortHeadline?: string;
}
export function normalizeSpec(raw: unknown): ComposeSpec {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const layout = (LAYOUT_IDS as readonly string[]).includes(String(o.layout)) ? (o.layout as LayoutId) : 'EDITORIAL_BOTTOM';
  let aspect = (ASPECTS as readonly string[]).includes(String(o.aspect)) ? (o.aspect as Aspect) : '4:5';
  if (!LAYOUT_ASPECTS[layout].includes(aspect)) aspect = '4:5';
  const theme = (THEME_IDS as readonly string[]).includes(String(o.theme)) ? (o.theme as ThemeId) : 'INK';
  const shortHeadline = normalizeCopyText(o.shortHeadline, COPY_LIMITS.headline);
  return { layout, aspect, theme, copy: normalizeCopy(o.copy), ...(shortHeadline ? { shortHeadline } : {}) };
}

/* ── Scripts and bidi ─────────────────────────────────────────────────── */

type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'WS' | 'ON';
const isHebrew = (cp: number) => (cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f);
const isArabic = (cp: number) => (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0x08a0 && cp <= 0x08ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
const isGeorgian = (cp: number) => (cp >= 0x10a0 && cp <= 0x10ff) || (cp >= 0x1c90 && cp <= 0x1cbf) || (cp >= 0x2d00 && cp <= 0x2d2f);
const LETTER = /[\p{L}\p{M}]/u;

function bidiClass(ch: string): BidiClass {
  const cp = ch.codePointAt(0)!;
  if (isHebrew(cp)) return 'R';
  if (isArabic(cp)) {
    if ((cp >= 0x0660 && cp <= 0x0669) || cp === 0x066b || cp === 0x066c) return 'AN';
    if (cp >= 0x06f0 && cp <= 0x06f9) return 'EN';
    if (cp === 0x060c) return 'CS';
    return 'AL';
  }
  if (cp >= 0x30 && cp <= 0x39) return 'EN';
  if (/\s/.test(ch)) return 'WS';
  if (ch === ',' || ch === '.' || ch === ':' || ch === '/' || ch === ' ') return 'CS';
  if (ch === '+' || ch === '-' || ch === '−') return 'ES';
  if (/[#$%°¢£¥€₾₽₺₪٪]/u.test(ch)) return 'ET';
  if (LETTER.test(ch)) return 'L';
  return 'ON';
}

export type Dir = 'ltr' | 'rtl';
/** Direction from the first strong letter (UBA P2/P3); no strong letter → the fallback. */
export function textDirection(text: string, fallback: Dir = 'ltr'): Dir {
  for (const ch of text) {
    const c = bidiClass(ch);
    if (c === 'L') return 'ltr';
    if (c === 'R' || c === 'AL') return 'rtl';
  }
  return fallback;
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };

/** Resolved embedding level per character of one line (UBA W1–W7, N1–N2, I1–I2; one paragraph, no explicit embeddings). */
export function bidiLevels(chars: string[], base: Dir): number[] {
  const p = base === 'rtl' ? 1 : 0;
  const sos: BidiClass = p ? 'R' : 'L';
  const t: BidiClass[] = chars.map(bidiClass);
  // W2: EN after an Arabic letter is an Arabic number. W3: AL → R.
  let lastStrong: BidiClass = sos;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'L' || t[i] === 'R' || t[i] === 'AL') lastStrong = t[i];
    else if (t[i] === 'EN' && lastStrong === 'AL') t[i] = 'AN';
  }
  for (let i = 0; i < t.length; i++) if (t[i] === 'AL') t[i] = 'R';
  // W4: a single separator between two numbers of the same kind joins them.
  for (let i = 1; i < t.length - 1; i++) {
    if (t[i] === 'ES' && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
    else if (t[i] === 'CS' && t[i - 1] === 'EN' && t[i + 1] === 'EN') t[i] = 'EN';
    else if (t[i] === 'CS' && t[i - 1] === 'AN' && t[i + 1] === 'AN') t[i] = 'AN';
  }
  // W5: terminators touching a European number belong to it.
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== 'ET') continue;
    let j = i; while (j < t.length && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < t.length && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  // W6: what is left of separators/terminators is neutral.
  for (let i = 0; i < t.length; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  // W7: EN after a strong L (or an L start) is L.
  lastStrong = sos;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 'L' || t[i] === 'R') lastStrong = t[i];
    else if (t[i] === 'EN' && lastStrong === 'L') t[i] = 'L';
  }
  // N1/N2: neutrals take the direction of equal strong neighbours (numbers count as R), else the base.
  const strongOf = (c: BidiClass): 'L' | 'R' | null => (c === 'L' ? 'L' : c === 'R' || c === 'EN' || c === 'AN' ? 'R' : null);
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== 'WS' && t[i] !== 'ON') continue;
    let j = i; while (j < t.length && (t[j] === 'WS' || t[j] === 'ON')) j++;
    const before = i > 0 ? strongOf(t[i - 1]) : (p ? 'R' : 'L');
    const after = j < t.length ? strongOf(t[j]) : (p ? 'R' : 'L');
    const dir: BidiClass = before && before === after ? before : (p ? 'R' : 'L');
    for (let k = i; k < j; k++) t[k] = dir;
    i = j - 1;
  }
  // I1/I2.
  return t.map((c) => (p === 0 ? (c === 'R' ? 1 : c === 'AN' || c === 'EN' ? 2 : 0) : (c === 'R' ? 1 : 2)));
}

/* ── Measurement ──────────────────────────────────────────────────────── */

export interface TextMeasurer {
  /** Advance width in px of one single-font, single-direction run. */
  advance(text: string, font: FontKey, weight: Weight, size: number, rtl: boolean): number;
  /** Whether the font has a glyph for the code point. */
  covers(font: FontKey, cp: number): boolean;
  /** Ascender/descender in em (descender positive). */
  metrics(font: FontKey): { ascender: number; descender: number };
}

/** hhea ascender/descender of a TrueType/OpenType file, in em. */
export function readVerticalMetrics(bytes: Uint8Array): { ascender: number; descender: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint16(4);
  let head = -1, hhea = -1;
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
    if (tag === 'head') head = dv.getUint32(rec + 8);
    if (tag === 'hhea') hhea = dv.getUint32(rec + 8);
  }
  if (head < 0 || hhea < 0) return { ascender: 1.07, descender: 0.29 };
  const upem = dv.getUint16(head + 18);
  return { ascender: dv.getInt16(hhea + 4) / upem, descender: -dv.getInt16(hhea + 6) / upem };
}

/**
 * The measurer used by BOTH the server and the tests: HarfBuzz shaping of the
 * pinned font files (`hb` is an initialised harfbuzzjs instance). Pure apart
 * from the wasm calls; results are cached per run.
 */
export function createHarfbuzzMeasurer(hb: any, faces: Record<FontFaceKey, Uint8Array>): TextMeasurer {
  const fonts = new Map<FontFaceKey, { font: any; upem: number }>();
  const cover = new Map<FontKey, Set<number>>();
  const vm = new Map<FontKey, { ascender: number; descender: number }>();
  for (const key of Object.keys(FONT_FILES) as FontFaceKey[]) {
    const face = hb.createFace(hb.createBlob(faces[key]), 0);
    fonts.set(key, { font: hb.createFont(face), upem: face.upem });
    const fk = key.split('-')[0] as FontKey;
    if (!cover.has(fk)) {
      cover.set(fk, new Set(Array.from(face.collectUnicodes() as ArrayLike<number>)));
      vm.set(fk, readVerticalMetrics(faces[key]));
    }
  }
  const cache = new Map<string, number>();
  return {
    advance(text, font, weight, size, rtl) {
      const k = `${font}-${weight}|${rtl ? 1 : 0}|${text}`;
      let em = cache.get(k);
      if (em == null) {
        const f = fonts.get(`${font}-${weight}`)!;
        const buf = hb.createBuffer();
        buf.addText(text);
        buf.guessSegmentProperties();
        buf.setDirection(rtl ? 'rtl' : 'ltr');
        hb.shape(f.font, buf);
        em = (buf.json() as Array<{ ax: number }>).reduce((s, g) => s + g.ax, 0) / f.upem;
        buf.destroy();
        cache.set(k, em);
      }
      return em * size;
    },
    covers: (font, cp) => cover.get(font)?.has(cp) ?? false,
    metrics: (font) => vm.get(font) ?? { ascender: 1.07, descender: 0.29 },
  };
}

/* ── Runs: one font, one direction, explicit x ────────────────────────── */

export interface PlacedRun { text: string; x: number; width: number; font: FontKey; level: number }
export interface PlacedLine { text: string; runs: PlacedRun[]; width: number; baseline: number; top: number; height: number; x: number }

function scriptFont(cp: number): FontKey | null {
  if (isGeorgian(cp)) return 'georgian';
  if (isArabic(cp)) return 'arabic';
  if (isHebrew(cp)) return 'hebrew';
  return LETTER.test(String.fromCodePoint(cp)) ? 'sans' : null;
}

/** Logical runs of one line: same level AND same font; odd-level runs never start or end with a neutral. */
export function lineRuns(line: string, base: Dir, m: TextMeasurer): Array<{ text: string; font: FontKey; level: number }> {
  const chars = Array.from(line);
  const levels = bidiLevels(chars, base);
  const own = chars.map((c) => scriptFont(c.codePointAt(0)!));
  // Neutrals, digits and punctuation take the neighbouring letter's font when it has the glyph.
  const fonts: FontKey[] = chars.map((c, i) => {
    if (own[i]) return own[i]!;
    let near: FontKey | null = null;
    for (let j = i - 1; j >= 0 && !near; j--) near = own[j];
    for (let j = i + 1; j < chars.length && !near; j++) near = own[j];
    const cp = c.codePointAt(0)!;
    return near && m.covers(near, cp) ? near : 'sans';
  });
  const neutral = (c: string) => { const b = bidiClass(c); return b === 'WS' || b === 'ON' || b === 'CS' || b === 'ES' || b === 'ET'; };
  const runs: Array<{ text: string; font: FontKey; level: number }> = [];
  let i = 0;
  while (i < chars.length) {
    let j = i + 1;
    while (j < chars.length && levels[j] === levels[i] && fonts[j] === fonts[i]) j++;
    let seg = chars.slice(i, j);
    const lvl = levels[i];
    if (lvl % 2 === 1) {
      // An odd run drawn on its own must not carry edge neutrals (the renderer would put them on the wrong side).
      let a = 0; while (a < seg.length && neutral(seg[a])) a++;
      let b = seg.length; while (b > a && neutral(seg[b - 1])) b--;
      if (a > 0) runs.push({ text: seg.slice(0, a).join(''), font: fonts[i], level: lvl });
      if (b > a) runs.push({ text: seg.slice(a, b).join(''), font: fonts[i], level: lvl });
      if (b < seg.length) runs.push({ text: seg.slice(b).join(''), font: fonts[i], level: lvl });
    } else {
      runs.push({ text: seg.join(''), font: fonts[i], level: lvl });
    }
    seg = [];
    i = j;
  }
  // Edge spaces become their own (undrawn) runs: renderers disagree on spaces at a text element's edges.
  return runs.flatMap((r) => {
    const m0 = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!;
    return [m0[1], m0[2], m0[3]].filter(Boolean).map((text) => ({ ...r, text }));
  });
}

const isNeutralRun = (s: string) => Array.from(s).every((c) => { const b = bidiClass(c); return b !== 'L' && b !== 'R' && b !== 'AL' && b !== 'EN' && b !== 'AN'; });

/** Visual order (UBA L2) and widths of a line's runs; odd-level neutral runs are reversed and mirrored here. */
function measureLine(line: string, base: Dir, weight: Weight, size: number, m: TextMeasurer) {
  const logical = lineRuns(line, base, m).map((r) => {
    const odd = r.level % 2 === 1;
    const text = odd && isNeutralRun(r.text) ? Array.from(r.text).reverse().map((c) => MIRROR[c] ?? c).join('') : r.text;
    const rtl = odd && !isNeutralRun(r.text);
    return { ...r, text, width: m.advance(text, r.font, weight, size, rtl) };
  });
  const visual = [...logical];
  const max = Math.max(0, ...visual.map((r) => r.level));
  const minOdd = visual.reduce((lo, r) => (r.level % 2 === 1 ? Math.min(lo, r.level) : lo), Infinity);
  for (let lvl = max; lvl >= (Number.isFinite(minOdd) ? minOdd : max + 1); lvl--) {
    for (let i = 0; i < visual.length; i++) {
      if (visual[i].level < lvl) continue;
      let j = i; while (j < visual.length && visual[j].level >= lvl) j++;
      visual.splice(i, j - i, ...visual.slice(i, j).reverse());
      i = j;
    }
  }
  return { logical, visual, width: visual.reduce((s, r) => s + r.width, 0) };
}

/* ── Wrapping and fitting ─────────────────────────────────────────────── */

function greedy(words: string[], width: number, fits: (s: string) => number): string[] | null {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (fits(w) > width) return null; // a word is never split or hidden
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next) <= width) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const NUMERIC = /^[+\-−]?[\d٠-٩۰-۹][\d٠-٩۰-۹.,٫٬]*%?$/;
const CURRENCY = /^[$€£₾₽₺₪¥]$/;
/**
 * Break units: a number never leaves its unit or currency ("78 m²", "95 000 $",
 * "$ 95,000"), and a space-grouped number stays whole. The words keep their
 * single spaces — the typeset line is still exactly the customer's text.
 */
export function breakUnits(text: string): string[] {
  const words = text.split(' ').filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    const prevLast = prev?.split(' ').pop() ?? '';
    const glue = prev != null && (
      (NUMERIC.test(prevLast) && (/^\d{3}([.,]\d+)?$/.test(w) || Array.from(w).length <= 4)) ||
      (CURRENCY.test(prevLast) && NUMERIC.test(w)) ||
      (CURRENCY.test(w) && NUMERIC.test(prevLast))
    );
    if (glue) out[out.length - 1] = `${prev} ${w}`; else out.push(w);
  }
  return out;
}

/** Greedy wrap, then the narrowest width that keeps the same line count (no orphaned last word). */
export function wrapText(text: string, width: number, maxLines: number, measure: (s: string) => number, balance: boolean): string[] | null {
  const words = breakUnits(text);
  if (!words.length) return [];
  const lines = greedy(words, width, measure);
  if (!lines || lines.length > maxLines) return null;
  if (!balance || lines.length < 2) return lines;
  let lo = Math.max(...words.map(measure)), hi = width;
  for (let k = 0; k < 14 && hi - lo > 1; k++) {
    const mid = (lo + hi) / 2;
    const l = greedy(words, mid, measure);
    if (l && l.length === lines.length) hi = mid; else lo = mid;
  }
  return greedy(words, hi, measure) ?? lines;
}

/* ── Geometry ─────────────────────────────────────────────────────────── */

export interface Rect { x: number; y: number; w: number; h: number }
type Align = 'start' | 'center';
interface Geometry {
  visual: Rect; radius: number; panel: Rect | null; text: Rect; align: Align; valign: 'start' | 'center' | 'end';
  overlay: boolean; typeScale: number; scrimFade: { from: number; to: number } | null;
}
const M = 72;

export function layoutGeometry(layout: LayoutId, aspect: Aspect, dir: Dir): Geometry {
  const { w: W, h: H } = CANVAS[aspect];
  const story = aspect === '9:16';
  const top = (y: number) => (story ? Math.max(y, STORY_SAFE) : y);
  const bottom = (y: number) => (story ? Math.min(y, H - STORY_SAFE) : y);
  const box = (x: number, y0: number, w: number, y1: number): Rect => ({ x, y: top(y0), w, h: bottom(y1) - top(y0) });
  switch (layout) {
    case 'EDITORIAL_TOP': {
      const ph = Math.round(H * ({ '1:1': 0.42, '4:5': 0.4, '9:16': 0.44 } as const)[aspect]);
      return { visual: { x: 0, y: ph, w: W, h: H - ph }, radius: 0, panel: { x: 0, y: 0, w: W, h: ph }, text: box(M, 64, W - 2 * M, ph - 52),
        align: 'start', valign: 'center', overlay: false, typeScale: 1, scrimFade: null };
    }
    case 'SPLIT_START': {
      const pw = Math.round(W * 0.5);
      const px = dir === 'rtl' ? W - pw : 0;
      return { visual: { x: dir === 'rtl' ? 0 : pw, y: 0, w: W - pw, h: H }, radius: 0, panel: { x: px, y: 0, w: pw, h: H },
        text: box(px + 60, 88, pw - 60 - 52, H - 88), align: 'start', valign: 'center', overlay: false, typeScale: 0.72, scrimFade: null };
    }
    case 'OVERLAY_BOTTOM': {
      const zh = Math.round(H * ({ '1:1': 0.46, '4:5': 0.44, '9:16': 0.42 } as const)[aspect]);
      const zy = (story ? H - STORY_SAFE : H) - zh;
      return { visual: { x: 0, y: 0, w: W, h: H }, radius: 0, panel: null, text: box(M, zy + 40, W - 2 * M, H - 64),
        align: 'start', valign: 'end', overlay: true, typeScale: 1, scrimFade: { from: zy - 160, to: zy + 24 } };
    }
    case 'CENTERED_MINIMAL': {
      const y0 = story ? STORY_SAFE : M;
      const vh = Math.round((H - y0 - (story ? STORY_SAFE : 0)) * 0.56);
      return { visual: { x: M, y: y0, w: W - 2 * M, h: vh }, radius: 28, panel: null, text: box(M, y0 + vh + 44, W - 2 * M, H - 64),
        align: 'center', valign: 'center', overlay: false, typeScale: 0.9, scrimFade: null };
    }
    case 'EDITORIAL_BOTTOM':
    default: {
      const vh = Math.round(H * ({ '1:1': 0.58, '4:5': 0.6, '9:16': 0.56 } as const)[aspect]);
      return { visual: { x: 0, y: 0, w: W, h: vh }, radius: 0, panel: { x: 0, y: vh, w: W, h: H - vh }, text: box(M, vh + 52, W - 2 * M, H - 60),
        align: 'start', valign: 'center', overlay: false, typeScale: 1, scrimFade: null };
    }
  }
}

/** Plain-English guidance the IMAGE prompt receives for the layout (where the visual must stay calm). */
export function layoutVisualGuidance(layout: LayoutId, aspect: Aspect = '4:5'): string {
  const g = layoutGeometry(layout, aspect, 'ltr');
  const { h: H } = CANVAS[aspect];
  if (g.overlay) {
    const pct = Math.round(((H - g.text.y + 40) / H) * 100);
    return `Keep the lower ${pct}% of the frame visually calm and low in detail (a plain floor, wall, sky, water or soft shadow) with no important subject in it; the main subject sits in the upper part of the frame.`;
  }
  if (layout === 'CENTERED_MINIMAL') return 'One clear, centred subject on a simple, uncluttered background with generous breathing room on every side.';
  return 'The picture will sit beside a separate design panel and may be cropped; keep the main subject well inside the central area with breathing room on every side.';
}

/* ── Typography ───────────────────────────────────────────────────────── */

interface Role { max: number; min: number; floor: number; maxLines: number; weight: Weight; lh: number; balance: boolean }
const ROLES: Record<CopyField, Role> = {
  brand: { max: 26, min: 24, floor: 22, maxLines: 1, weight: 700, lh: 1.25, balance: false },
  badge: { max: 26, min: 24, floor: 22, maxLines: 1, weight: 700, lh: 1.2, balance: false },
  headline: { max: 84, min: 48, floor: 40, maxLines: 3, weight: 700, lh: 1.14, balance: true },
  subheadline: { max: 40, min: 30, floor: 26, maxLines: 3, weight: 400, lh: 1.34, balance: true },
  offer: { max: 44, min: 32, floor: 28, maxLines: 2, weight: 700, lh: 1.2, balance: false },
  cta: { max: 34, min: 28, floor: 24, maxLines: 1, weight: 700, lh: 1.2, balance: false },
};
/** Taller scripts get more leading so diacritics and descenders never touch. */
const SCRIPT_LEADING: Record<FontKey, number> = { sans: 0, georgian: 0.1, arabic: 0.3, hebrew: 0.08 };
const GAP_AFTER: Record<CopyField, number> = { brand: 18, badge: 24, headline: 22, subheadline: 22, offer: 22, cta: 0 };
const CTA_PAD = { x: 36, y: 20 };
const BADGE_PAD = { x: 20, y: 10 };

function primaryFont(text: string): FontKey {
  for (const ch of text) { const f = scriptFont(ch.codePointAt(0)!); if (f && f !== 'sans') return f; }
  return 'sans';
}

/* ── Contrast (WCAG 2.x) ──────────────────────────────────────────────── */

const hex = (c: string) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export function luminance(c: string | number[]): number {
  const [r, g, b] = typeof c === 'string' ? hex(c) : c;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a: string | number[], b: string | number[]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}
export const MIN_CONTRAST = 4.5;

/** What the server measured of the visual under the text area (8-bit channel values). */
export interface VisualStats { brightest: number[]; darkest: number[] }

/** Scrim opacity so the worst pixel under the text still meets MIN_CONTRAST against the text colour. */
export function scrimAlphaFor(textColor: string, scrimColor: string, stats: VisualStats | null): number {
  const worst = stats ? (luminance(textColor) > 0.5 ? stats.brightest : stats.darkest) : (luminance(textColor) > 0.5 ? [255, 255, 255] : [0, 0, 0]);
  const s = hex(scrimColor);
  for (let a = 0.3; a <= 0.95 + 1e-9; a += 0.01) {
    const blend = worst.map((v, i) => Math.round(a * s[i] + (1 - a) * v));
    if (contrastRatio(textColor, blend) >= MIN_CONTRAST + 0.2) return Math.round(a * 100) / 100;
  }
  return 0.95;
}

/* ── Compose ──────────────────────────────────────────────────────────── */

export interface PlacedBlock {
  field: CopyField; text: string; size: number; weight: Weight; color: string; lines: PlacedLine[];
  box: Rect; pill: { rect: Rect; fill: string } | null;
}
export type CheckCode =
  | 'HEADLINE_REQUIRED' | 'TEXT_TOO_LONG' | 'CTA_TOO_LONG' | 'LOW_CONTRAST' | 'OUT_OF_BOUNDS' | 'OVERLAP'
  | 'LAYOUT_ASPECT' | 'MIXED_SCRIPT_WORD' | 'LAYOUT_CHANGED' | 'SHORT_HEADLINE_USED';
export interface Check { code: CheckCode; field?: CopyField; blocking: boolean; detail?: string }
export interface Composition {
  engine: number;
  spec: ComposeSpec;
  /** The layout really used (a longer copy may move to a roomier one). */
  layout: LayoutId;
  canvas: { w: number; h: number };
  dir: Dir;
  background: string;
  visual: Rect & { radius: number };
  panel: (Rect & { fill: string }) | null;
  scrim: { rect: Rect; color: string; alpha: number; fadeFrom: number; fadeTo: number } | null;
  textRegion: Rect;
  blocks: PlacedBlock[];
  /** Exactly the strings typeset, per field (the source of truth stored with the export). */
  copy: CreativeCopy;
  checks: Check[];
  ok: boolean;
}

const inside = (a: Rect, b: Rect, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Words that mix two alphabets ("Oინ"): the exact defect production showed — flagged for the customer. */
export function mixedScriptWords(text: string): string[] {
  return text.split(/[\s\-–—/·,.:;!?()«»"']+/).filter((w) => {
    const scripts = new Set(Array.from(w).map((c) => { const cp = c.codePointAt(0)!; return LETTER.test(c) ? (isGeorgian(cp) ? 'ka' : isArabic(cp) ? 'ar' : isHebrew(cp) ? 'he' : /\p{Script=Cyrillic}/u.test(c) ? 'cy' : /\p{Script=Latin}/u.test(c) ? 'la' : 'x') : null; }).filter(Boolean));
    return scripts.size > 1;
  });
}

function composeOnce(spec: ComposeSpec, layout: LayoutId, copy: CreativeCopy, m: TextMeasurer, stats: VisualStats | null): Composition {
  const { aspect } = spec;
  const theme = THEMES[spec.theme];
  const canvas = CANVAS[aspect];
  const dir = textDirection(copy.headline || copy.subheadline || copy.cta || '', 'ltr');
  const g = layoutGeometry(layout, aspect, dir);
  const checks: Check[] = [];
  if (!LAYOUT_ASPECTS[layout].includes(aspect)) checks.push({ code: 'LAYOUT_ASPECT', blocking: true });
  if (!copy.headline) checks.push({ code: 'HEADLINE_REQUIRED', field: 'headline', blocking: true });

  const textColor = g.overlay ? (spec.theme === 'INK' ? '#FFFFFF' : theme.text) : theme.text;
  const mutedColor = g.overlay ? textColor : theme.muted;
  const accentColor = g.overlay ? (spec.theme === 'INK' ? theme.accent : theme.accent) : theme.accent;
  const colorOf: Record<CopyField, string> = { brand: mutedColor, badge: accentColor, headline: textColor, subheadline: mutedColor, offer: accentColor, cta: theme.ctaText };
  const fields = COPY_FIELDS.filter((f) => copy[f]);
  const s = g.typeScale;
  const sizeAt = (f: CopyField, t: number) => {
    const r = ROLES[f];
    const max = Math.max(r.floor, Math.round(r.max * s)), min = Math.max(r.floor, Math.round(r.min * s));
    return Math.round(max - (max - min) * t);
  };
  const maxLinesOf = (f: CopyField) => (f === 'headline' && aspect === '9:16' ? 4 : ROLES[f].maxLines);
  const widthFor = (f: CopyField) => (f === 'cta' ? g.text.w - 2 * CTA_PAD.x : f === 'badge' ? g.text.w - 2 * BADGE_PAD.x : g.text.w) * 0.97;

  type Laid = { f: CopyField; size: number; lines: string[]; lh: number; font: FontKey; h: number };
  let laid: Laid[] | null = null;
  let culprit: CopyField | null = null;
  const STEPS = 18;
  for (let k = 0; k <= STEPS && !laid; k++) {
    const t = k / STEPS;
    const out: Laid[] = [];
    let failed: CopyField | null = null;
    for (const f of fields) {
      const size = sizeAt(f, t);
      const r = ROLES[f];
      const text = copy[f]!;
      const font = primaryFont(text);
      const lines = wrapText(text, widthFor(f), maxLinesOf(f), (x) => measureLine(x, dir, r.weight, size, m).width, r.balance);
      if (!lines) { failed = f; break; }
      const lh = r.lh + SCRIPT_LEADING[font];
      const lineH = size * lh;
      const h = f === 'cta' ? size * 1.25 + 2 * CTA_PAD.y : f === 'badge' ? size * 1.2 + 2 * BADGE_PAD.y : lineH * lines.length;
      out.push({ f, size, lines, lh, font, h });
    }
    if (failed) { culprit = failed; continue; }
    const total = out.reduce((acc, b, i) => acc + b.h + (i < out.length - 1 ? GAP_AFTER[b.f] * Math.max(0.75, s) : 0), 0);
    if (total <= g.text.h) laid = out;
    else culprit = out.find((b) => b.f === 'headline') ? 'headline' : out[0]?.f ?? 'headline';
  }

  const blocks: PlacedBlock[] = [];
  if (!laid) {
    const f = culprit ?? 'headline';
    checks.push({ code: f === 'cta' ? 'CTA_TOO_LONG' : 'TEXT_TOO_LONG', field: f, blocking: true });
  } else {
    const total = laid.reduce((acc, b, i) => acc + b.h + (i < laid!.length - 1 ? GAP_AFTER[b.f] * Math.max(0.75, s) : 0), 0);
    let y = g.valign === 'start' ? g.text.y : g.valign === 'end' ? g.text.y + g.text.h - total : g.text.y + (g.text.h - total) / 2;
    const physical = (w: number, x0: number, avail: number) =>
      g.align === 'center' ? x0 + (avail - w) / 2 : dir === 'rtl' ? x0 + avail - w : x0;
    for (const b of laid) {
      const r = ROLES[b.f];
      const pill = b.f === 'cta' || b.f === 'badge';
      const pad = b.f === 'cta' ? CTA_PAD : BADGE_PAD;
      const lines: PlacedLine[] = [];
      const fontsUsed = new Set<FontKey>();
      const measured = b.lines.map((ln) => { const ml = measureLine(ln, dir, r.weight, b.size, m); ml.logical.forEach((x) => fontsUsed.add(x.font)); return { ln, ml }; });
      const asc = Math.max(...[...fontsUsed].map((f) => m.metrics(f).ascender), 0.8);
      const desc = Math.max(...[...fontsUsed].map((f) => m.metrics(f).descender), 0.2);
      let pillRect: Rect | null = null;
      if (pill) {
        const ml = measured[0]?.ml;
        const w = (ml?.width ?? 0) + 2 * pad.x;
        pillRect = { x: physical(w, g.text.x, g.text.w), y, w, h: b.h };
      }
      const lineH = pill ? b.size * 1.2 : b.size * b.lh;
      measured.forEach(({ ln, ml }, i) => {
        const top = pill ? pillRect!.y + pad.y : y + i * lineH;
        const x = pill ? pillRect!.x + pad.x : physical(ml.width, g.text.x, g.text.w);
        const baseline = top + (lineH - (asc + desc) * b.size) / 2 + asc * b.size;
        let cx = x;
        const runs: PlacedRun[] = ml.visual.map((run) => { const pr = { text: run.text, x: cx, width: run.width, font: run.font, level: run.level }; cx += run.width; return pr; });
        lines.push({ text: ln, runs, width: ml.width, baseline, top, height: lineH, x });
      });
      const box: Rect = pillRect ?? {
        x: Math.min(...lines.map((l) => l.x)), y, w: Math.max(...lines.map((l) => l.width)), h: b.h,
      };
      blocks.push({
        field: b.f, text: copy[b.f]!, size: b.size, weight: r.weight, color: colorOf[b.f], lines, box,
        pill: pillRect ? { rect: pillRect, fill: b.f === 'cta' ? theme.ctaFill : 'none' } : null,
      });
      y += b.h + GAP_AFTER[b.f] * Math.max(0.75, s);
    }
  }

  // Background behind the text: a solid panel, the page, or the visual under a scrim.
  let scrim: Composition['scrim'] = null;
  if (g.overlay && g.scrimFade) {
    const scrimColor = theme.scrim;
    const alpha = Math.max(...blocks.filter((b) => b.field !== 'cta').map((b) => scrimAlphaFor(b.color, scrimColor, stats)), scrimAlphaFor(textColor, scrimColor, stats));
    scrim = { rect: { x: 0, y: g.scrimFade.from, w: canvas.w, h: canvas.h - g.scrimFade.from }, color: scrimColor, alpha, fadeFrom: g.scrimFade.from, fadeTo: g.scrimFade.to };
  }
  const behind = (b: PlacedBlock): number[][] => {
    if (b.field === 'cta') return [hex(theme.ctaFill)];
    if (!g.overlay) return [hex(theme.bg)];
    const sc = hex(scrim!.color);
    const worst = stats ? [stats.brightest, stats.darkest] : [[255, 255, 255], [0, 0, 0]];
    return worst.map((px) => px.map((v, i) => Math.round(scrim!.alpha * sc[i] + (1 - scrim!.alpha) * v)));
  };
  for (const b of blocks) {
    const worst = Math.min(...behind(b).map((bg) => contrastRatio(b.color, bg)));
    if (worst < MIN_CONTRAST) checks.push({ code: 'LOW_CONTRAST', field: b.field, blocking: true, detail: String(worst) });
  }
  // Every glyph run stays in the text area (and out of Stories UI zones); no block touches another; panels never cover the visual.
  const safe: Rect = aspect === '9:16' ? { x: 0, y: STORY_SAFE, w: canvas.w, h: canvas.h - 2 * STORY_SAFE } : { x: 0, y: 0, w: canvas.w, h: canvas.h };
  for (const b of blocks) {
    const boxes = [b.box, ...b.lines.map((l) => ({ x: l.x, y: l.top, w: l.width, h: l.height }))];
    if (boxes.some((bx) => !inside(bx, g.text, 2) || !inside(bx, safe, 2))) checks.push({ code: 'OUT_OF_BOUNDS', field: b.field, blocking: true });
  }
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    if (intersects(blocks[i].box, blocks[j].box)) checks.push({ code: 'OVERLAP', field: blocks[j].field, blocking: true });
  }
  if (!g.overlay && intersects(g.text, g.visual)) checks.push({ code: 'OVERLAP', blocking: true, detail: 'visual' });
  for (const f of fields) if (mixedScriptWords(copy[f]!).length) checks.push({ code: 'MIXED_SCRIPT_WORD', field: f, blocking: false, detail: mixedScriptWords(copy[f]!).join(' ') });

  return {
    engine: CREATIVE_ENGINE_VERSION, spec, layout, canvas, dir,
    background: theme.bg,
    visual: { ...g.visual, radius: g.radius },
    panel: g.panel ? { ...g.panel, fill: theme.bg } : null,
    scrim, textRegion: g.text, blocks, copy,
    checks, ok: !checks.some((c) => c.blocking),
  };
}

/**
 * The composition for a spec. Too-long copy first tries the approved shorter
 * headline, then a layout with more room for text — never clipping, hiding a
 * word or shrinking below the role's minimum size.
 */
export function composeCreative(rawSpec: ComposeSpec, m: TextMeasurer, stats: VisualStats | null = null): Composition {
  const spec = normalizeSpec(rawSpec);
  const tooLong = (c: Composition) => c.checks.some((x) => x.code === 'TEXT_TOO_LONG' || x.code === 'CTA_TOO_LONG');
  const first = composeOnce(spec, spec.layout, spec.copy, m, stats);
  if (!tooLong(first)) return first;
  const short = spec.shortHeadline && spec.shortHeadline !== spec.copy.headline ? { ...spec.copy, headline: spec.shortHeadline } : null;
  const attempts: Array<[LayoutId, CreativeCopy, CheckCode[]]> = [];
  if (short) attempts.push([spec.layout, short, ['SHORT_HEADLINE_USED']]);
  for (const l of ROOMIEST) if (l !== spec.layout && LAYOUT_ASPECTS[l].includes(spec.aspect)) attempts.push([l, spec.copy, ['LAYOUT_CHANGED']]);
  if (short) for (const l of ROOMIEST) if (l !== spec.layout && LAYOUT_ASPECTS[l].includes(spec.aspect)) attempts.push([l, short, ['LAYOUT_CHANGED', 'SHORT_HEADLINE_USED']]);
  for (const [layout, copy, notes] of attempts) {
    const c = composeOnce(spec, layout, copy, m, stats);
    if (!tooLong(c)) return { ...c, checks: [...notes.map((code) => ({ code, blocking: false } as Check)), ...c.checks] };
  }
  return first;
}

/* ── The one serializer ───────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);

export interface SvgTarget {
  /** The visual's href: a signed URL in the browser, a data: URI for the export. */
  visualHref: string;
  families: Record<FontKey, string>;
  /** Unique per document so several previews can share a page. */
  idPrefix?: string;
}

export function renderCreativeSvg(c: Composition, target: SvgTarget): string {
  const id = target.idPrefix ?? 'hmc';
  const { w: W, h: H } = c.canvas;
  const v = c.visual;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xml:space="preserve" data-engine="${c.engine}" data-layout="${c.layout}" data-aspect="${c.spec.aspect}">`);
  out.push(`<defs><clipPath id="${id}-v"><rect x="${n(v.x)}" y="${n(v.y)}" width="${n(v.w)}" height="${n(v.h)}" rx="${n(v.radius)}" ry="${n(v.radius)}"/></clipPath>`);
  if (c.scrim) {
    const s = c.scrim;
    out.push(`<linearGradient id="${id}-s" gradientUnits="userSpaceOnUse" x1="0" y1="${n(s.fadeFrom)}" x2="0" y2="${n(s.fadeTo)}"><stop offset="0" stop-color="${s.color}" stop-opacity="0"/><stop offset="1" stop-color="${s.color}" stop-opacity="${s.alpha}"/></linearGradient>`);
  }
  out.push('</defs>');
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${c.background}"/>`);
  if (c.panel) out.push(`<rect x="${n(c.panel.x)}" y="${n(c.panel.y)}" width="${n(c.panel.w)}" height="${n(c.panel.h)}" fill="${c.panel.fill}"/>`);
  const href = esc(target.visualHref);
  out.push(`<image x="${n(v.x)}" y="${n(v.y)}" width="${n(v.w)}" height="${n(v.h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-v)" href="${href}" xlink:href="${href}"/>`);
  if (c.scrim) out.push(`<rect x="${n(c.scrim.rect.x)}" y="${n(c.scrim.rect.y)}" width="${n(c.scrim.rect.w)}" height="${n(c.scrim.rect.h)}" fill="url(#${id}-s)"/>`);
  for (const b of c.blocks) {
    out.push(`<g data-field="${b.field}">`);
    if (b.pill) {
      const p = b.pill.rect;
      const stroke = b.pill.fill === 'none' ? ` stroke="${b.color}" stroke-width="2"` : '';
      out.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="${n(p.h / 2)}" ry="${n(p.h / 2)}" fill="${b.pill.fill}"${stroke}/>`);
    }
    for (const l of b.lines) {
      for (const r of l.runs) {
        if (!r.text.trim()) continue;
        out.push(`<text x="${n(r.x)}" y="${n(l.baseline)}" font-family="${esc(target.families[r.font])}" font-size="${b.size}" font-weight="${b.weight}" fill="${b.color}">${esc(r.text)}</text>`);
      }
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}

/** The customer-safe summary stored with an export (no measurer internals). */
export function compositionRecord(c: Composition) {
  return {
    engine: c.engine, layout: c.layout, requestedLayout: c.spec.layout, aspect: c.spec.aspect, theme: c.spec.theme,
    copy: c.copy, dir: c.dir, ok: c.ok, checks: c.checks,
    sizes: Object.fromEntries(c.blocks.map((b) => [b.field, b.size])),
    lines: Object.fromEntries(c.blocks.map((b) => [b.field, b.lines.map((l) => l.text)])),
  };
}

/** Text the visual-check / tests can compare against: every block's lines, logical order, joined. */
export function typesetText(c: Composition): Partial<Record<CopyField, string>> {
  return Object.fromEntries(c.blocks.map((b) => [b.field, b.lines.map((l) => l.text).join(' ')]));
}
