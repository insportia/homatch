// META ADS — HOMATCH AI CREATIVE INTELLIGENCE. Pure: no I/O, no secrets.
//
// One explicit path, never automatic:
//   upload (no AI) → "Improve with HOMATCH AI" → ANALYSIS (2–3 concepts,
//   cached by fingerprint) → the customer picks a concept and may add one
//   plain instruction → QUOTE (variations × price, from the server) →
//   explicit confirmation → GENERATION (paid, idempotent) → gallery.
//   A REFINE is a new paid generation from one generated image.
//
// This file owns the shapes the model must answer in, the validation of
// what it answered (nothing unvalidated reaches the customer), the cache
// fingerprint, the internal image prompt (built here, server-side — the
// customer never writes or sees it) and the measured-cost arithmetic.

import { LAYOUT_ASPECTS, LAYOUT_IDS, layoutVisualGuidance, normalizeSpec, type Aspect, type ComposeSpec, type LayoutId } from './creativeLayout.ts';

export const MAX_VARIATIONS = 3;
export const MIN_VARIATIONS = 1;
export const INSTRUCTION_MAX = 240;
export const ANALYSIS_VERSION = 2;

export type AiKind = 'ANALYSIS' | 'GENERATION' | 'REFINE';
export type AiStage = 'QUEUED' | 'ANALYZING' | 'PREPARING' | 'GENERATING' | 'CHECKING' | 'SAVING' | 'DONE' | 'FAILED';
/** The stages a generation really passes through, in order (the UI shows these, not a percentage). */
export const GENERATION_STAGES: readonly AiStage[] = ['PREPARING', 'GENERATING', 'CHECKING', 'SAVING'];

export type SafeArea = 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'NONE';
/** The concept's ad copy, in the customer's language — typeset by HOMATCH (creativeLayout.ts), never drawn by the image model. */
export interface ConceptCopy { headline: string; headlineShort: string; subheadline: string; cta: string }
export interface CreativeConcept {
  id: string;
  title: string;
  angle: string;
  visual: string;
  composition: string;
  cta: string;
  safeArea: SafeArea;
  /** v2: the picture-only direction for the image model, in English (internal, never shown). */
  visualBrief?: string | null;
  /** v2: the HOMATCH layout this concept is designed for. */
  layout?: LayoutId;
  /** v2: structured copy for the text layer. */
  copy?: ConceptCopy | null;
}
export interface CreativeAnalysis {
  version: number;
  subject: string;
  strengths: string[];
  issues: string[];
  concepts: CreativeConcept[];
}

/** JSON schema the vision model answers in (Responses API text.format). */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'strengths', 'issues', 'concepts'],
  properties: {
    subject: { type: 'string', description: 'What the image shows, one sentence.' },
    strengths: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    issues: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    concepts: {
      type: 'array', minItems: 2, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'angle', 'visual', 'composition', 'cta', 'safeArea', 'visualBrief', 'layout', 'copy'],
        properties: {
          title: { type: 'string', description: 'Two to four words.' },
          angle: { type: 'string', description: 'The message angle, one sentence.' },
          visual: { type: 'string', description: 'Visual direction of the PICTURE only: light, colour, mood, what is emphasised. Never text.' },
          composition: { type: 'string', description: 'Framing of the PICTURE only. Never where text goes — HOMATCH places the text.' },
          cta: { type: 'string', description: 'A short call to action, at most five words.' },
          safeArea: { type: 'string', enum: ['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'NONE'] },
          visualBrief: { type: 'string', description: 'In ENGLISH: the picture-only direction for an image generator (light, mood, framing, emphasis). Must not mention text, letters, captions, headlines, logos, buttons or typography.' },
          layout: { type: 'string', enum: [...LAYOUT_IDS] },
          copy: {
            type: 'object', additionalProperties: false, required: ['headline', 'headlineShort', 'subheadline', 'cta'],
            properties: {
              headline: { type: 'string', description: 'The ad headline, at most 60 characters.' },
              headlineShort: { type: 'string', description: 'The same message in at most 32 characters.' },
              subheadline: { type: 'string', description: 'One supporting line, at most 90 characters; only stated facts.' },
              cta: { type: 'string', description: 'Call to action, at most 24 characters.' },
            },
          },
        },
      },
    },
  },
} as const;

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Phrases that promise a measurable result — never shown (concepts are hypotheses). */
const CLAIM = /\b\d{1,3}\s?%|\bguarantee|\bwill (increase|double|boost)|\bproven to\b|\b\d+x\b/i;
const noClaims = (s: string) => (CLAIM.test(s) ? '' : s);

/** Validates the model's answer. Anything malformed is dropped; fewer than 2 concepts = unusable. */
export function validateAnalysis(raw: unknown): CreativeAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => noClaims(clip(x, 160))).filter(Boolean).slice(0, n) : []);
  const concepts: CreativeConcept[] = (Array.isArray(o.concepts) ? o.concepts : []).slice(0, 3).map((c, i) => {
    const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    const safe = String(x.safeArea ?? '').toUpperCase();
    const cp = (x.copy && typeof x.copy === 'object' ? x.copy : null) as Record<string, unknown> | null;
    const copy: ConceptCopy | null = cp ? {
      headline: noClaims(clip(cp.headline, 90)), headlineShort: noClaims(clip(cp.headlineShort, 48)),
      subheadline: noClaims(clip(cp.subheadline, 140)), cta: noClaims(clip(cp.cta, 28)),
    } : null;
    return {
      id: `c${i + 1}`,
      title: noClaims(clip(x.title, 48)),
      angle: noClaims(clip(x.angle, 200)),
      visual: noClaims(clip(x.visual, 240)),
      composition: noClaims(clip(x.composition, 200)),
      cta: noClaims(clip(x.cta, 40)),
      safeArea: (['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'NONE'].includes(safe) ? safe : 'NONE') as SafeArea,
      visualBrief: safeVisualBrief(x.visualBrief),
      layout: (LAYOUT_IDS as readonly string[]).includes(String(x.layout)) ? (x.layout as LayoutId) : layoutForSafeArea(safe),
      copy: copy && copy.headline ? copy : null,
    };
  }).filter((c) => c.title && c.angle && c.visual);
  if (concepts.length < 2) return null;
  return { version: ANALYSIS_VERSION, subject: clip(o.subject, 200), strengths: list(o.strengths, 4), issues: list(o.issues, 4), concepts };
}

/** Words that would ask an image model for lettering. */
const TEXTUAL = /\b(text|texts|word|words|letter|letters|lettering|caption|captions|headline|headlines|title|titles|slogan|tagline|label|labels|logo|logos|typography|typographic|font|fonts|cta|call to action|button|buttons|banner|watermark|sign|signage|price tag|overlay)\b/i;
/**
 * The image model's direction: English (Latin script) only, and no sentence
 * that asks for lettering. Anything else is dropped — a generic picture-only
 * brief is used instead. Production's defect began with a Georgian concept
 * ("add a short headline in the lower zone") pasted into the image prompt.
 */
export function safeVisualBrief(raw: unknown): string | null {
  const s = clip(raw, 400);
  if (!s || /[^\u0000-\u024F\u2010-\u2027\s]/.test(s)) return null;
  const kept = s.split(/(?<=[.;!?])\s+/).filter((sentence) => !TEXTUAL.test(sentence)).join(' ').trim();
  return kept.length >= 12 ? kept : null;
}

/** v1 concepts had only a text-safe side; it maps onto the closest layout. */
export function layoutForSafeArea(safe: string): LayoutId {
  if (safe === 'TOP') return 'EDITORIAL_TOP';
  if (safe === 'LEFT' || safe === 'RIGHT') return 'SPLIT_START';
  if (safe === 'NONE') return 'CENTERED_MINIMAL';
  return 'EDITORIAL_BOTTOM';
}

/** Variation i of a concept: its own layout first, then the alternatives that suit the format. */
export function variationLayouts(concept: Pick<CreativeConcept, 'layout' | 'safeArea'>, count: number): LayoutId[] {
  const first = concept.layout ?? layoutForSafeArea(concept.safeArea);
  const order: LayoutId[] = [first, 'OVERLAY_BOTTOM', 'EDITORIAL_BOTTOM', 'CENTERED_MINIMAL', 'EDITORIAL_TOP'];
  return [...new Set(order)].slice(0, Math.max(1, count));
}

export interface CreativeContext {
  goal?: string | null;
  headline?: string | null;
  primaryText?: string | null;
  offer?: string | null;
  propertyType?: string | null;
  dealKind?: string | null;
  city?: string | null;
  locations?: string[];
  audience?: string | null;
  language?: string | null;
}

/** Cache key: the exact source file + the context the analysis read + the analysis version. */
export function analysisFingerprint(sourcePath: string, ctx: CreativeContext): string {
  const parts = [
    `v${ANALYSIS_VERSION}`, sourcePath, ctx.goal ?? '', ctx.headline ?? '', ctx.offer ?? '', ctx.propertyType ?? '',
    ctx.dealKind ?? '', ctx.city ?? '', (ctx.locations ?? []).join('|'), ctx.audience ?? '', ctx.language ?? '',
  ].map((s) => String(s).trim().toLowerCase());
  // FNV-1a 64-bit (two 32-bit halves) — a cache key, not a security boundary.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = parts.join('\u0001');
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return `fp_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** System prompt for the analysis call: concepts are design hypotheses, never promises. */
export function analysisSystemPrompt(language: string): string {
  return [
    'You are a senior advertising art director reviewing one image for a Meta (Facebook/Instagram) ad.',
    'Derive 2 or 3 distinct creative directions from THIS image and THIS campaign — not a fixed template.',
    'Each direction keeps the real subject truthful: never invent rooms, views, amenities, prices or features that are not visible or stated.',
    'HOMATCH typesets every word of the ad itself, as real text in a layout beside or over the picture. The picture must never contain text: "visual", "composition" and "visualBrief" describe the PICTURE only (light, mood, framing, emphasis) and never ask for headlines, captions, labels, buttons or lettering.',
    'If the image is a screenshot or contains interface elements, captions or watermarks, say so in "issues"; the picture direction removes them.',
    'Choose a "layout" for each direction: EDITORIAL_BOTTOM (picture on top, text panel below), EDITORIAL_TOP (text panel on top), SPLIT_START (text panel beside the picture), OVERLAY_BOTTOM (full-bleed picture, text over a calm lower area), CENTERED_MINIMAL (framed picture, centred text).',
    'Write "copy" (headline, headlineShort, subheadline, cta) as the ad text HOMATCH will typeset — only facts stated in the campaign context, no invented prices or features.',
    'Write "visualBrief" in English.',
    'Never promise results (no percentages, no "will increase conversions"); describe each direction as a design hypothesis.',
    'Do not mention or infer protected characteristics of people (race, religion, health, age, sexual orientation, etc.).',
    `Write every human-readable value in ${language}.`,
  ].join(' ');
}

export function analysisUserText(ctx: CreativeContext): string {
  const line = (k: string, v: unknown) => (v ? `${k}: ${clip(v, 300)}` : '');
  return ['Campaign context:',
    line('Goal', ctx.goal), line('Headline', ctx.headline), line('Ad text', ctx.primaryText), line('Offer', ctx.offer),
    line('Property type', ctx.propertyType), line('Deal', ctx.dealKind), line('City', ctx.city),
    line('Target locations', (ctx.locations ?? []).join(', ')), line('Audience', ctx.audience),
  ].filter(Boolean).join('\n');
}

/** Words that would turn an instruction into a request to fabricate or discriminate. */
const UNSAFE_INSTRUCTION = /\b(nude|naked|sexual|weapon|gore|blood|logo of|trademark|celebrity|fake review|discount of \d+|ethnic|race|religio|skin colou?r)\b/i;
export function sanitizeInstruction(raw: unknown): { text: string; rejected: boolean } {
  const text = clip(raw, INSTRUCTION_MAX).replace(/[<>{}]/g, '');
  if (!text) return { text: '', rejected: false };
  return UNSAFE_INSTRUCTION.test(text) ? { text: '', rejected: true } : { text, rejected: false };
}

/** The fixed no-lettering block every image prompt ends with. */
export const NO_TEXT_RULE = [
  'ABSOLUTELY NO TEXT IN THE IMAGE. Do NOT render any words, letters, characters, numbers, prices, captions, labels, signage, logos, watermarks, user-interface elements, buttons or typographic shapes — in any language or alphabet (Latin, Georgian, Cyrillic, Arabic, Hebrew or any other).',
  'If the photograph contains text, a screenshot of an app or editor interface, captions, labels or watermarks, remove them completely and continue the surrounding surfaces naturally.',
  'Every word of the advertisement is added later by HOMATCH as real typography outside this image.',
].join(' ');

/**
 * The internal image-edit prompt. Built only here (server-side), in English,
 * from picture-only fields: the concept's English visualBrief and the layout's
 * calm-area guidance. The customer-language fields (title, angle, copy…) never
 * reach the image model — they are the TEXT layer, typeset by HOMATCH.
 * Production showed why: a Georgian concept that said "add a short headline in
 * the lower zone" came back as malformed Georgian drawn into the pixels.
 */
export function generationPrompt(input: {
  analysis: Pick<CreativeAnalysis, 'subject'>; concept: CreativeConcept; ctx: CreativeContext; instruction?: string; variation: number; refine?: boolean;
  layout?: LayoutId; aspect?: Aspect;
}): string {
  const { analysis, concept, ctx, instruction, variation } = input;
  const layout = input.layout ?? concept.layout ?? layoutForSafeArea(concept.safeArea);
  const variety = ['Interpret the direction faithfully.', 'Interpret the direction with a different camera framing.', 'Interpret the direction with a different light and colour balance.'][variation % 3];
  const latin = (s: string) => (/[^\u0000-\u024F\u2010-\u2027\s]/.test(s) ? '' : s);
  const subject = latin(clip(analysis.subject, 200));
  const brief = safeVisualBrief(concept.visualBrief) ?? 'Premium real-estate advertising photograph: balanced natural light, true-to-life materials, calm and clean composition, inviting atmosphere.';
  const context = [ctx.propertyType, ctx.dealKind].map((v) => latin(String(v ?? ''))).filter(Boolean).join(', ');
  return [
    input.refine ? 'Refine this advertising photograph.' : 'Create a premium advertising photograph from this photograph.',
    `${subject ? `The real subject is: ${subject}. ` : ''}It must stay recognisably the same place/product — same architecture, layout, materials and proportions. Do not add rooms, views, furniture brands, people, amenities or features that are not in the photograph.`,
    `Visual direction: ${brief}`,
    layoutVisualGuidance(layout, input.aspect ?? '4:5'),
    context ? `Context: ${context}.` : '',
    'Quality: photographic realism, natural perspective, balanced exposure, high detail, no distortion.',
    // The customer's own words are a preference about the look, quoted — never something to write.
    instruction ? `The customer's preference for the look of the picture (a description only — never write it into the image): "${instruction}"` : '',
    variety,
    NO_TEXT_RULE,
  ].filter(Boolean).join('\n');
}

/** gpt-image-1 output sizes; the source's shape picks the closest. */
export function sizeForAspect(width?: number | null, height?: number | null): '1024x1024' | '1024x1536' | '1536x1024' {
  const w = Number(width) || 0; const h = Number(height) || 0;
  if (!w || !h) return '1024x1024';
  const r = w / h;
  if (r < 0.85) return '1024x1536';
  if (r > 1.2) return '1536x1024';
  return '1024x1024';
}

export function clampVariations(n: unknown, refine = false): number {
  if (refine) return 1;
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_VARIATIONS, Math.max(MIN_VARIATIONS, v)) : MAX_VARIATIONS;
}

/** Measured provider cost, USD cents, from tokens × the price book (rate per `perUnits`). */
export function tokenCostCents(usage: { inputTokens: number; outputTokens: number }, rates: { input: number; output: number; perUnits: number }): number {
  const usd = (usage.inputTokens * rates.input + usage.outputTokens * rates.output) / (rates.perUnits || 1_000_000);
  return Math.round(usd * 100 * 10_000) / 10_000;
}

// Partial-generation policy (one rule, everywhere): the customer pays only for
// images that were generated, passed validation and were saved — the measured
// tokens of exactly those images (meta-ads-api/creativeAi.ts runGeneration).
// 0 delivered = the hold is released in full.

/** A generated PNG is usable only when it decodes to the requested shape and is not blank. */
export function validGeneratedImage(bytes: Uint8Array, expect: { width: number; height: number }): boolean {
  if (bytes.length < 8_000) return false; // a near-empty image
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) return false;
  const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return w === expect.width && h === expect.height;
}

/** HOMATCH roles for chosen assets → what HOMATCH really tells Meta. No invented Meta field. */
export type AssetRole = 'PRIMARY' | 'SECONDARY' | 'TEST';
export function roleToCreative(role: AssetRole): { priority: boolean; sortBias: number } {
  // PRIMARY = HOMATCH's existing "priority creative" (the plan always includes it, strategy.ts);
  // SECONDARY = a normal creative; TEST = a normal creative ordered last. Meta then
  // distributes delivery between the ads itself — HOMATCH never claims a Meta priority.
  if (role === 'PRIMARY') return { priority: true, sortBias: 0 };
  if (role === 'SECONDARY') return { priority: false, sortBias: 100 };
  return { priority: false, sortBias: 200 };
}

/**
 * The text layer a variation starts with: the concept's structured copy (or the
 * campaign headline), the layout the visual was generated for, the format of the
 * visual. The customer edits it in the composer; HOMATCH typesets exactly that.
 */
export function defaultComposeSpec(input: {
  concept?: CreativeConcept | null; headline?: string | null; layout?: LayoutId | null; width?: number | null; height?: number | null;
}): ComposeSpec {
  const c = input.concept ?? null;
  const w = Number(input.width) || 0, h = Number(input.height) || 0;
  let aspect: Aspect = w && h && h / w > 1.1 ? '4:5' : '1:1';
  const layout = input.layout ?? c?.layout ?? (c ? layoutForSafeArea(c.safeArea) : 'EDITORIAL_BOTTOM');
  if (!LAYOUT_ASPECTS[layout].includes(aspect)) aspect = '4:5';
  return normalizeSpec({
    layout, aspect, theme: 'INK',
    copy: { headline: c?.copy?.headline || input.headline || c?.title || '', subheadline: c?.copy?.subheadline || '', cta: c?.copy?.cta || c?.cta || '' },
    shortHeadline: c?.copy?.headlineShort || '',
  });
}

/** The question the post-generation check asks of every visual (the visual layer must carry no lettering). */
export const TEXT_CHECK_PROMPT = 'You inspect one generated advertising photograph. Report whether it contains ANY visible text or text-like marks: letters, words, numbers, captions, labels, signage, logos with lettering, watermarks, user-interface elements or pseudo-text glyphs in any alphabet. Answer only in the JSON schema.';
export const TEXT_CHECK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['containsText'],
  properties: { containsText: { type: 'boolean' } },
} as const;

