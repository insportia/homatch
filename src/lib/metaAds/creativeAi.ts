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

export const MAX_VARIATIONS = 3;
export const MIN_VARIATIONS = 1;
export const INSTRUCTION_MAX = 240;
export const ANALYSIS_VERSION = 1;

export type AiKind = 'ANALYSIS' | 'GENERATION' | 'REFINE';
export type AiStage = 'QUEUED' | 'ANALYZING' | 'PREPARING' | 'GENERATING' | 'CHECKING' | 'SAVING' | 'DONE' | 'FAILED';
/** The stages a generation really passes through, in order (the UI shows these, not a percentage). */
export const GENERATION_STAGES: readonly AiStage[] = ['PREPARING', 'GENERATING', 'CHECKING', 'SAVING'];

export type SafeArea = 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT' | 'NONE';
export interface CreativeConcept {
  id: string;
  title: string;
  angle: string;
  visual: string;
  composition: string;
  cta: string;
  safeArea: SafeArea;
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
        required: ['title', 'angle', 'visual', 'composition', 'cta', 'safeArea'],
        properties: {
          title: { type: 'string', description: 'Two to four words.' },
          angle: { type: 'string', description: 'The message angle, one sentence.' },
          visual: { type: 'string', description: 'Visual direction: light, colour, mood, what is emphasised.' },
          composition: { type: 'string', description: 'Framing and hierarchy guidance.' },
          cta: { type: 'string', description: 'A short call to action, at most five words.' },
          safeArea: { type: 'string', enum: ['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'NONE'] },
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
    return {
      id: `c${i + 1}`,
      title: noClaims(clip(x.title, 48)),
      angle: noClaims(clip(x.angle, 200)),
      visual: noClaims(clip(x.visual, 240)),
      composition: noClaims(clip(x.composition, 200)),
      cta: noClaims(clip(x.cta, 40)),
      safeArea: (['TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'NONE'].includes(safe) ? safe : 'NONE') as SafeArea,
    };
  }).filter((c) => c.title && c.angle && c.visual);
  if (concepts.length < 2) return null;
  return { version: ANALYSIS_VERSION, subject: clip(o.subject, 200), strengths: list(o.strengths, 4), issues: list(o.issues, 4), concepts };
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
    'Good CTA framing is tasteful: clear hierarchy, a calm text-safe area, no giant buttons, no cluttered banner text.',
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

/**
 * The internal image-edit prompt. Built only here (server-side). The real
 * subject stays the subject; the concept steers light, mood, framing and the
 * text-safe area. The model is told NOT to render text: Meta's ad shows the
 * headline and CTA button itself, and baked-in text is unreadable at feed
 * size, rejected by the 20%-text guidance and impossible to translate.
 */
export function generationPrompt(input: {
  analysis: Pick<CreativeAnalysis, 'subject'>; concept: CreativeConcept; ctx: CreativeContext; instruction?: string; variation: number; refine?: boolean;
}): string {
  const { analysis, concept, ctx, instruction, variation } = input;
  const safe = concept.safeArea === 'NONE' ? '' : `Keep a calm, uncluttered area at the ${concept.safeArea.toLowerCase()} of the frame where the platform can overlay text.`;
  const variety = ['Interpret the direction faithfully.', 'Interpret the direction with a different camera framing.', 'Interpret the direction with a different light and colour balance.'][variation % 3];
  return [
    input.refine ? 'Refine this advertising image.' : 'Create a premium advertising image from this photograph.',
    `The real subject is: ${clip(analysis.subject, 200)}. It must stay recognisably the same place/product — same architecture, layout, materials and proportions. Do not add rooms, views, furniture brands, people, amenities or features that are not in the photograph.`,
    `Creative direction "${concept.title}": ${concept.angle} Visual: ${concept.visual} Composition: ${concept.composition}`,
    safe,
    ctx.propertyType || ctx.dealKind ? `Context: ${[ctx.propertyType, ctx.dealKind, ctx.city].filter(Boolean).join(', ')}.` : '',
    'Quality: photographic realism, natural perspective, clean hierarchy, balanced exposure, high detail, no distortion, no watermark.',
    'Do NOT render any words, letters, numbers, prices, logos or buttons in the image.',
    instruction ? `Customer's request: ${instruction}` : '',
    variety,
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
