// HOMATCH DESIGN STUDIO — the image models a render may be finished or edited by, behind one interface.
//
//   finish(base, prompt, size)       the whole Blender picture, given a photoreal look
//   edit(image, mask, prompt, size)  only the masked region repainted (mask: 1 = editable)
//
// Both answer the picture's bytes, the provider's own usage report and the
// MEASURED cost: usage × the price table below (USD per 1M tokens, keyed by
// model, overridable by DS_RENDER_PRICES). A model without a price, or an
// answer without usage, is UNPRICED: cost null and flagged, never zero.
//
// Providers (verified against the official docs on 2026-10-02):
//   OPENAI  POST https://api.openai.com/v1/images/edits (multipart: model,
//           prompt, image, mask, size, quality, output_format, n). The mask
//           must be the image's size and format with an ALPHA channel: fully
//           transparent pixels are the ones the model may change.
//           Models: gpt-image-2 (snapshot gpt-image-2-2026-04-21),
//           gpt-image-2.5-sunburst, gpt-image-2.5-flare. Custom sizes:
//           multiples of 16, aspect 1:3–3:1, edges ≤ 3840, 655,360–8,294,400 px.
//           https://developers.openai.com/api/docs/guides/image-generation
//           https://developers.openai.com/api/docs/pricing
//   GEMINI  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//           (x-goog-api-key; contents[].parts[] text + inlineData; generationConfig
//           responseModalities ["IMAGE"], imageConfig {aspectRatio, imageSize}).
//           No mask parameter: the mask is sent as a second image with an
//           explicit instruction, and the route composites the answer back
//           inside the mask and checks outside it (renderCheck.ts).
//           Models: gemini-3-pro-image, gemini-3.1-flash-image, gemini-3.1-flash-lite-image.
//           https://ai.google.dev/gemini-api/docs/image-generation
//           https://ai.google.dev/gemini-api/docs/pricing
//
// Keys come only from the environment (OPENAI_API_KEY, GEMINI_API_KEY) and
// are never returned, logged or stored. Provider and model: DS_RENDER_PROVIDER
// / DS_RENDER_MODEL, with a safe default; an administrator may override per
// request for the benchmark (the route verifies is_admin() first).

export type ProviderId = 'OPENAI' | 'GEMINI';
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageBytes { bytes: Uint8Array; mime: ImageMime }
export interface Size { width: number; height: number }
/** 1 = the model may change this pixel. Same size as the image it masks. */
export interface EditMask { width: number; height: number; data: Uint8Array }

export interface ImageUsage {
  inputTextTokens: number | null;
  inputImageTokens: number | null;
  cachedInputTokens: number | null;
  outputImageTokens: number | null;
  outputTextTokens: number | null;
}

export interface ImageCost { usd: number | null; basis: 'ESTIMATED' | 'UNPRICED'; detail: string }

export type ImageResult =
  | { ok: true; provider: ProviderId; model: string; bytes: Uint8Array; mime: ImageMime; usage: ImageUsage; cost: ImageCost; ms: number; requestId: string | null }
  | { ok: false; provider: ProviderId; model: string; error: string; status: number | null; ms: number; cost: ImageCost };

export interface ImageProvider {
  id: ProviderId;
  models: readonly string[];
  model: string;
  finish(input: { base: ImageBytes; prompt: string; size: Size }): Promise<ImageResult>;
  edit(input: { image: ImageBytes; mask: EditMask; prompt: string; size: Size }): Promise<ImageResult>;
}

/** Injected so the providers stay testable and the edge supplies its own PNG encoder. */
export interface ProviderDeps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
  /** RGBA, 8-bit → PNG bytes. */
  encodePng: (rgba: Uint8Array, width: number, height: number) => Uint8Array;
  now?: () => number;
}

export const PROVIDER_MODELS: Readonly<Record<ProviderId, readonly string[]>> = Object.freeze({
  OPENAI: Object.freeze(['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']),
  GEMINI: Object.freeze(['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']),
});
export const DEFAULT_MODEL: Readonly<Record<ProviderId, string>> = Object.freeze({ OPENAI: 'gpt-image-2', GEMINI: 'gemini-3-pro-image' });
export const DEFAULT_PROVIDER: ProviderId = 'OPENAI';

// ── Prices ────────────────────────────────────────────────────────────────

/** USD per 1M tokens. null = not billed in that dimension / not known. */
export interface ModelPrice { textIn: number | null; imageIn: number | null; cachedIn: number | null; imageOut: number | null; textOut: number | null; source: string }

const OPENAI_PRICING = 'https://developers.openai.com/api/docs/pricing (2026-10-02)';
const GEMINI_PRICING = 'https://ai.google.dev/gemini-api/docs/pricing (2026-10-02)';
export const PRICE_TABLE: Readonly<Record<string, ModelPrice>> = Object.freeze({
  'gpt-image-2': { textIn: 5, imageIn: 8, cachedIn: 2, imageOut: 30, textOut: null, source: OPENAI_PRICING },
  'gpt-image-2.5-sunburst': { textIn: 5, imageIn: 8, cachedIn: 2, imageOut: 30, textOut: null, source: OPENAI_PRICING },
  'gpt-image-2.5-flare': { textIn: 5, imageIn: 8, cachedIn: 2, imageOut: 30, textOut: null, source: OPENAI_PRICING },
  'gemini-3-pro-image': { textIn: 2, imageIn: 2, cachedIn: null, imageOut: 120, textOut: 12, source: GEMINI_PRICING },
  'gemini-3.1-flash-image': { textIn: 0.5, imageIn: 0.5, cachedIn: null, imageOut: 60, textOut: 3, source: GEMINI_PRICING },
  // gemini-3.1-flash-lite-image: allowed for the benchmark, no verified price → UNPRICED.
});

/** The price table, with DS_RENDER_PRICES (JSON {model: ModelPrice-like}) layered over it. */
export function priceTable(env: (k: string) => string | undefined): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = { ...PRICE_TABLE };
  const raw = env('DS_RENDER_PRICES');
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
    for (const [model, p] of Object.entries(parsed ?? {})) {
      if (!/^[a-z0-9][a-z0-9_.-]{1,60}$/.test(model) || !p || typeof p !== 'object') continue;
      out[model] = { textIn: n(p.textIn), imageIn: n(p.imageIn), cachedIn: n(p.cachedIn), imageOut: n(p.imageOut), textOut: n(p.textOut), source: 'env:DS_RENDER_PRICES' };
    }
  } catch { /* a malformed override is ignored, never half-applied */ }
  return out;
}

/** usage × price. Any used dimension without a rate makes the whole call UNPRICED. */
export function costOf(model: string, usage: ImageUsage | null, prices: Record<string, ModelPrice>): ImageCost {
  const p = prices[model];
  if (!p) return { usd: null, basis: 'UNPRICED', detail: `no price for ${model}` };
  if (!usage) return { usd: null, basis: 'UNPRICED', detail: 'provider reported no usage' };
  const parts: Array<[number | null, number | null, string]> = [
    [usage.inputTextTokens, p.textIn, 'textIn'], [usage.inputImageTokens, p.imageIn, 'imageIn'],
    [usage.cachedInputTokens, p.cachedIn ?? p.imageIn, 'cachedIn'], [usage.outputImageTokens, p.imageOut, 'imageOut'],
    [usage.outputTextTokens, p.textOut, 'textOut'],
  ];
  let usd = 0;
  for (const [tokens, rate, name] of parts) {
    if (!tokens) continue;
    if (rate == null) return { usd: null, basis: 'UNPRICED', detail: `${model}: no ${name} rate` };
    usd += (tokens * rate) / 1_000_000;
  }
  if (usage.outputImageTokens == null && usage.inputTextTokens == null) return { usd: null, basis: 'UNPRICED', detail: 'usage incomplete' };
  return { usd: Math.round(usd * 1e6) / 1e6, basis: 'ESTIMATED', detail: `${model} tokens × ${p.source}` };
}

// ── Sizes ─────────────────────────────────────────────────────────────────

const OPENAI_MIN_PX = 655_360; const OPENAI_MAX_PX = 8_294_400; const OPENAI_MAX_EDGE = 3840;

/** The OpenAI size nearest the picture's own: multiples of 16, within the documented bounds, aspect kept. */
export function openAiSize(s: Size): string {
  let aspect = s.width / s.height;
  aspect = Math.min(3, Math.max(1 / 3, aspect));
  const px = Math.min(OPENAI_MAX_PX, Math.max(OPENAI_MIN_PX, s.width * s.height));
  let w = Math.sqrt(px * aspect); let h = w / aspect;
  if (w > OPENAI_MAX_EDGE) { w = OPENAI_MAX_EDGE; h = w / aspect; }
  if (h > OPENAI_MAX_EDGE) { h = OPENAI_MAX_EDGE; w = h * aspect; }
  let W = Math.max(16, Math.round(w / 16) * 16); let H = Math.max(16, Math.round(h / 16) * 16);
  // Rounding may fall outside the bounds: step back inside 16 pixels at a time, keeping the aspect.
  while (W * H < OPENAI_MIN_PX) { if (W / H < aspect) W += 16; else H += 16; }
  while (W * H > OPENAI_MAX_PX || W > OPENAI_MAX_EDGE || H > OPENAI_MAX_EDGE) { if (W / H > aspect) W -= 16; else H -= 16; }
  return `${W}x${H}`;
}

const GEMINI_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
/** The documented Gemini aspect ratio nearest the picture's own (log distance). */
export function geminiAspect(s: Size): string {
  const a = Math.log(s.width / s.height);
  let best: string = '1:1'; let d = Infinity;
  for (const r of GEMINI_RATIOS) {
    const [x, y] = r.split(':').map(Number);
    const dd = Math.abs(Math.log(x / y) - a);
    if (dd < d) { d = dd; best = r; }
  }
  return best;
}

// ── Mask encodings ────────────────────────────────────────────────────────

/** OpenAI: RGBA, transparent where editable, opaque black elsewhere. */
export function openAiMaskRgba(m: EditMask): Uint8Array {
  const out = new Uint8Array(m.width * m.height * 4);
  for (let i = 0; i < m.width * m.height; i += 1) out[i * 4 + 3] = m.data[i] ? 0 : 255;
  return out;
}
/** Gemini (and the contract): opaque, white where editable, black elsewhere. */
export function whiteMaskRgba(m: EditMask): Uint8Array {
  const out = new Uint8Array(m.width * m.height * 4);
  for (let i = 0; i < m.width * m.height; i += 1) { const v = m.data[i] ? 255 : 0; out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unbase64(s: string): Uint8Array | null {
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; }
}
const sniffMime = (b: Uint8Array): ImageMime | null =>
  b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 ? 'image/webp' : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const ext = (m: ImageMime) => (m === 'image/png' ? 'png' : m === 'image/jpeg' ? 'jpg' : 'webp');

// ── OpenAI ────────────────────────────────────────────────────────────────

/** The multipart request (exported for tests: field names are the contract with the provider). */
export function openAiEditRequest(input: { model: string; prompt: string; image: ImageBytes; maskPng: Uint8Array | null; size: Size; quality: string }): FormData {
  const form = new FormData();
  form.append('model', input.model);
  form.append('prompt', input.prompt);
  form.append('image', new Blob([input.image.bytes], { type: input.image.mime }), `image.${ext(input.image.mime)}`);
  if (input.maskPng) form.append('mask', new Blob([input.maskPng], { type: 'image/png' }), 'mask.png');
  form.append('size', openAiSize(input.size));
  form.append('quality', input.quality);
  form.append('output_format', 'png');
  form.append('n', '1');
  return form;
}

// deno-lint-ignore no-explicit-any
export function openAiUsage(payload: any): ImageUsage | null {
  const u = payload?.usage;
  if (!u || typeof u !== 'object') return null;
  const d = u.input_tokens_details ?? {};
  const total = num(u.input_tokens);
  const text = num(d.text_tokens); const image = num(d.image_tokens);
  const cached = num(d.cached_tokens);
  return {
    inputTextTokens: text ?? (image == null ? total : null),
    inputImageTokens: image,
    cachedInputTokens: cached,
    outputImageTokens: num(u.output_tokens_details?.image_tokens) ?? num(u.output_tokens),
    outputTextTokens: num(u.output_tokens_details?.text_tokens),
  };
}

export function openAiProvider(model: string, deps: ProviderDeps): ImageProvider {
  const prices = priceTable(deps.env);
  const now = deps.now ?? Date.now;
  const quality = (deps.env('DS_RENDER_QUALITY') ?? 'high').toLowerCase();
  const q = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality) ? quality : 'high';
  const call = async (form: FormData): Promise<ImageResult> => {
    const t0 = now();
    const key = deps.env('OPENAI_API_KEY');
    const unpriced: ImageCost = { usd: null, basis: 'UNPRICED', detail: 'no answer' };
    if (!key) return { ok: false, provider: 'OPENAI', model, error: 'PROVIDER_NOT_CONFIGURED', status: null, ms: 0, cost: unpriced };
    const r = await deps.fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form }).catch(() => null);
    const ms = now() - t0;
    if (!r) return { ok: false, provider: 'OPENAI', model, error: 'PROVIDER_NETWORK', status: null, ms, cost: unpriced };
    // deno-lint-ignore no-explicit-any
    const payload: any = await r.json().catch(() => null);
    const usage = openAiUsage(payload);
    const cost = costOf(model, usage, prices);
    if (!r.ok) return { ok: false, provider: 'OPENAI', model, error: `PROVIDER_REFUSED_${r.status}`, status: r.status, ms, cost: usage ? cost : unpriced };
    const bytes = typeof payload?.data?.[0]?.b64_json === 'string' ? unbase64(payload.data[0].b64_json) : null;
    const mime = bytes ? sniffMime(bytes) : null;
    if (!bytes || !mime) return { ok: false, provider: 'OPENAI', model, error: 'PROVIDER_NO_IMAGE', status: r.status, ms, cost };
    return { ok: true, provider: 'OPENAI', model, bytes, mime, usage: usage ?? { inputTextTokens: null, inputImageTokens: null, cachedInputTokens: null, outputImageTokens: null, outputTextTokens: null }, cost, ms, requestId: r.headers.get('x-request-id') };
  };
  return {
    id: 'OPENAI', models: PROVIDER_MODELS.OPENAI, model,
    finish: ({ base, prompt, size }) => call(openAiEditRequest({ model, prompt, image: base, maskPng: null, size, quality: q })),
    edit: ({ image, mask, prompt, size }) => call(openAiEditRequest({ model, prompt, image, maskPng: deps.encodePng(openAiMaskRgba(mask), mask.width, mask.height), size, quality: q })),
  };
}

// ── Gemini ────────────────────────────────────────────────────────────────

export const GEMINI_MASK_NOTE = 'The SECOND image is a mask of the first: change ONLY the pixels under its WHITE area; every pixel under its BLACK area must stay exactly as it is. Return one image at the first image\'s framing.';

/** The generateContent body (exported for tests). */
export function geminiRequest(input: { prompt: string; image: ImageBytes; maskPng: Uint8Array | null; size: Size; imageSize: string }) {
  const parts: unknown[] = [{ text: input.maskPng ? `${input.prompt}\n\n${GEMINI_MASK_NOTE}` : input.prompt }, { inlineData: { mimeType: input.image.mime, data: base64(input.image.bytes) } }];
  if (input.maskPng) parts.push({ inlineData: { mimeType: 'image/png', data: base64(input.maskPng) } });
  return {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: geminiAspect(input.size), imageSize: input.imageSize } },
  };
}

// deno-lint-ignore no-explicit-any
export function geminiUsage(payload: any): ImageUsage | null {
  const u = payload?.usageMetadata;
  if (!u || typeof u !== 'object') return null;
  const details: Array<{ modality?: string; tokenCount?: number }> = Array.isArray(u.candidatesTokensDetails) ? u.candidatesTokensDetails : [];
  const imageOut = details.filter((d) => d?.modality === 'IMAGE').reduce((s, d) => s + (num(d.tokenCount) ?? 0), 0);
  const candidates = num(u.candidatesTokenCount) ?? 0;
  const thoughts = num(u.thoughtsTokenCount) ?? 0;
  const prompt = num(u.promptTokenCount);
  const promptDetails: Array<{ modality?: string; tokenCount?: number }> = Array.isArray(u.promptTokensDetails) ? u.promptTokensDetails : [];
  const promptImage = promptDetails.filter((d) => d?.modality === 'IMAGE').reduce((s, d) => s + (num(d.tokenCount) ?? 0), 0);
  return {
    inputTextTokens: prompt == null ? null : prompt - promptImage,
    inputImageTokens: promptImage || null,
    cachedInputTokens: num(u.cachedContentTokenCount),
    // Without a modality breakdown every candidate token is billed as image output (the dearer rate: never under-counted).
    outputImageTokens: details.length ? imageOut : candidates,
    outputTextTokens: (details.length ? Math.max(0, candidates - imageOut) : 0) + thoughts || null,
  };
}

export function geminiProvider(model: string, deps: ProviderDeps): ImageProvider {
  const prices = priceTable(deps.env);
  const now = deps.now ?? Date.now;
  const imageSize = ['1K', '2K', '4K'].includes(deps.env('DS_RENDER_GEMINI_SIZE') ?? '') ? deps.env('DS_RENDER_GEMINI_SIZE')! : '2K';
  const call = async (body: unknown): Promise<ImageResult> => {
    const t0 = now();
    const key = deps.env('GEMINI_API_KEY');
    const unpriced: ImageCost = { usd: null, basis: 'UNPRICED', detail: 'no answer' };
    if (!key) return { ok: false, provider: 'GEMINI', model, error: 'PROVIDER_NOT_CONFIGURED', status: null, ms: 0, cost: unpriced };
    const r = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => null);
    const ms = now() - t0;
    if (!r) return { ok: false, provider: 'GEMINI', model, error: 'PROVIDER_NETWORK', status: null, ms, cost: unpriced };
    // deno-lint-ignore no-explicit-any
    const payload: any = await r.json().catch(() => null);
    const usage = geminiUsage(payload);
    const cost = costOf(model, usage, prices);
    if (!r.ok) return { ok: false, provider: 'GEMINI', model, error: `PROVIDER_REFUSED_${r.status}`, status: r.status, ms, cost: usage ? cost : unpriced };
    // deno-lint-ignore no-explicit-any
    const part = (payload?.candidates?.[0]?.content?.parts ?? []).find((p: any) => typeof p?.inlineData?.data === 'string');
    const bytes = part ? unbase64(part.inlineData.data) : null;
    const mime = bytes ? sniffMime(bytes) : null;
    if (!bytes || !mime) return { ok: false, provider: 'GEMINI', model, error: 'PROVIDER_NO_IMAGE', status: r.status, ms, cost };
    return { ok: true, provider: 'GEMINI', model, bytes, mime, usage: usage ?? { inputTextTokens: null, inputImageTokens: null, cachedInputTokens: null, outputImageTokens: null, outputTextTokens: null }, cost, ms, requestId: r.headers.get('x-goog-request-id') };
  };
  return {
    id: 'GEMINI', models: PROVIDER_MODELS.GEMINI, model,
    finish: ({ base, prompt, size }) => call(geminiRequest({ prompt, image: base, maskPng: null, size, imageSize })),
    edit: ({ image, mask, prompt, size }) => call(geminiRequest({ prompt, image, maskPng: deps.encodePng(whiteMaskRgba(mask), mask.width, mask.height), size, imageSize })),
  };
}

// ── Selection ─────────────────────────────────────────────────────────────

const isProvider = (v: unknown): v is ProviderId => v === 'OPENAI' || v === 'GEMINI';

/**
 * The provider for this request: the admin override when given (already
 * verified as an administrator by the caller) and valid, else the
 * environment's choice, else the default. A model not on the provider's list
 * falls back to its default model. Null when that provider has no key.
 */
export function selectProvider(
  deps: ProviderDeps, override: { provider?: unknown; model?: unknown } | null = null,
  /** The production choice recorded after the benchmark (admin_settings design_studio_render_model): wins over the environment. */
  configured: { provider?: unknown; model?: unknown } | null = null,
): ImageProvider | null {
  const envProvider = (deps.env('DS_RENDER_PROVIDER') ?? '').toUpperCase();
  const confProvider = typeof configured?.provider === 'string' ? configured.provider.toUpperCase() : '';
  const provider: ProviderId = isProvider(override?.provider) ? override!.provider as ProviderId
    : isProvider(confProvider) ? confProvider : isProvider(envProvider) ? envProvider : DEFAULT_PROVIDER;
  const wanted = typeof override?.model === 'string' && isProvider(override?.provider) ? override.model
    : isProvider(confProvider) && typeof configured?.model === 'string' ? configured.model : deps.env('DS_RENDER_MODEL') ?? '';
  const model = PROVIDER_MODELS[provider].includes(wanted) ? wanted : DEFAULT_MODEL[provider];
  const keyName = provider === 'OPENAI' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  if (!deps.env(keyName)) return null;
  return provider === 'OPENAI' ? openAiProvider(model, deps) : geminiProvider(model, deps);
}
