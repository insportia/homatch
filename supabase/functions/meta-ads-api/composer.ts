// META ADS — HOMATCH CREATIVE COMPOSER (server side). No model call, no charge.
//
// The image model makes the VISUAL; this file makes the AD: it typesets the
// customer's structured copy with the shared layout engine
// (src/lib/metaAds/creativeLayout.ts) and rasterises the very SVG the browser
// preview shows into the PNG Meta receives. A text or layout edit runs only
// this — zero image-model calls.
//
// Engine assets (fonts, resvg, HarfBuzz) are the pinned files the preview
// loads (public/creative-engine on the site origin). Every file is checked
// against its SHA-256 in creativeLayout.ts before use; a mismatch refuses to
// compose rather than typeset with an unknown font.

import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import hbjs from 'npm:harfbuzzjs@0.3.6/hbjs.js';
import {
  BROWSER_FAMILY, CREATIVE_ASSET_BASE, ENGINE_FILES, EXPORT_FAMILY, FONT_FILES,
  composeCreative, compositionRecord, createHarfbuzzMeasurer, normalizeSpec, renderCreativeSvg,
  type ComposeSpec, type Composition, type FontFaceKey, type TextMeasurer, type VisualStats,
} from '../../../src/lib/metaAds/creativeLayout.ts';

const ORIGIN = Deno.env.get('CREATIVE_ASSET_ORIGIN') || 'https://www.homatch.live';

interface Engine { measurer: TextMeasurer; fontBuffers: Uint8Array[] }
let engine: Promise<Engine> | null = null;

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pinned(file: string, expected: string): Promise<Uint8Array> {
  const r = await fetch(new URL(CREATIVE_ASSET_BASE + file, ORIGIN));
  if (!r.ok) throw new Error(`ASSET_UNAVAILABLE:${file}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if ((await sha256(bytes)) !== expected) throw new Error(`ASSET_INTEGRITY:${file}`);
  return bytes;
}

/** Loaded once per isolate; a failed load is retried on the next request. */
function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const [rv, hbw, ...fonts] = await Promise.all([
      pinned(ENGINE_FILES.resvg.file, ENGINE_FILES.resvg.sha256),
      pinned(ENGINE_FILES.harfbuzz.file, ENGINE_FILES.harfbuzz.sha256),
      ...Object.values(FONT_FILES).map((f) => pinned(f.file, f.sha256)),
    ]);
    await initWasm(rv);
    const { instance } = (await WebAssembly.instantiate(hbw as unknown as ArrayBuffer)) as WebAssembly.WebAssemblyInstantiatedSource;
    const faces = Object.fromEntries(Object.keys(FONT_FILES).map((k, i) => [k, fonts[i]])) as Record<FontFaceKey, Uint8Array>;
    return { measurer: createHarfbuzzMeasurer(hbjs(instance), faces), fontBuffers: fonts };
  })().catch((e) => { engine = null; throw e; });
  return engine;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function sniffMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return null;
}

// Edge requests have ~2 s of CPU: the final export keeps the high-quality resampler (it shows); the
// luminance sample uses the fast one (a percentile does not need bicubic). One export per request.
const render = (e: Engine, svg: string, fast = false) =>
  new Resvg(svg, { imageRendering: fast ? 1 : 0, font: { fontBuffers: e.fontBuffers, loadSystemFonts: false, defaultFontFamily: EXPORT_FAMILY.sans } }).render();

/**
 * The brightest/darkest pixels of the visual under the text area — exactly as
 * the composition crops it — so an overlay scrim is as strong as it must be
 * for 4.5:1, and no stronger.
 */
function statsUnderText(e: Engine, c: Composition, dataUri: string): VisualStats {
  const k = 4; // quarter resolution is plenty for a luminance percentile
  const { w: W, h: H } = c.canvas;
  const v = c.visual;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W / k}" height="${H / k}" viewBox="0 0 ${W} ${H}"><image x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" preserveAspectRatio="xMidYMid slice" href="${dataUri}"/></svg>`;
  const img = render(e, svg, true);
  const px = img.pixels; // the getter copies the bitmap: read once
  const r = c.textRegion;
  const lum: Array<[number, number, number, number]> = [];
  for (let y = Math.floor(r.y / k); y < Math.min(img.height, Math.ceil((r.y + r.h) / k)); y++) {
    for (let x = Math.floor(r.x / k); x < Math.min(img.width, Math.ceil((r.x + r.w) / k)); x++) {
      const i = (y * img.width + x) * 4;
      if (px[i + 3] < 8) continue;
      lum.push([0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2], px[i], px[i + 1], px[i + 2]]);
    }
  }
  img.free?.();
  if (!lum.length) return { brightest: [255, 255, 255], darkest: [0, 0, 0] };
  lum.sort((a, b) => a[0] - b[0]);
  const at = (q: number) => lum[Math.min(lum.length - 1, Math.max(0, Math.round(q * (lum.length - 1))))];
  const hi = at(0.98), lo = at(0.02);
  return { brightest: [hi[1], hi[2], hi[3]], darkest: [lo[1], lo[2], lo[3]] };
}

export interface Composed {
  composition: Composition;
  record: ReturnType<typeof compositionRecord>;
  /** The preview SVG: browser font names, the visual by URL. */
  previewSvg: (visualUrl: string, idPrefix?: string) => string;
}

/** Layout + legibility for a spec over these visual bytes (no rasterising of the ad). */
export async function composeOver(visual: Uint8Array, rawSpec: unknown): Promise<Composed & { dataUri: string } | { error: string }> {
  const mime = sniffMime(visual);
  if (!mime) return { error: 'UNSUPPORTED_SOURCE' };
  let e: Engine;
  try { e = await loadEngine(); } catch (err) { console.log(JSON.stringify({ tag: 'meta_creative_compose', event: 'engine_unavailable', error: String((err as Error)?.message ?? err).slice(0, 120) })); return { error: 'COMPOSER_UNAVAILABLE' }; }
  const spec: ComposeSpec = normalizeSpec(rawSpec);
  const dataUri = `data:${mime};base64,${b64(visual)}`;
  const first = composeCreative(spec, e.measurer, null);
  const c = first.scrim ? composeCreative({ ...spec, layout: first.layout }, e.measurer, statsUnderText(e, first, dataUri)) : first;
  // A fallback layout chosen in the first pass is kept; its notes come from the first pass.
  const composition = c === first ? c : { ...c, checks: [...first.checks.filter((x) => x.code === 'LAYOUT_CHANGED' || x.code === 'SHORT_HEADLINE_USED'), ...c.checks.filter((x) => x.code !== 'LAYOUT_CHANGED' && x.code !== 'SHORT_HEADLINE_USED')] };
  return {
    composition, record: compositionRecord(composition), dataUri,
    previewSvg: (url, idPrefix) => renderCreativeSvg(composition, { visualHref: url, families: BROWSER_FAMILY, idPrefix }),
  };
}

/** The final Meta asset: the SAME SVG (file font names, the visual inline) rasterised to PNG. */
export async function exportPng(composed: Composed & { dataUri: string }): Promise<{ png: Uint8Array; sha256: string; width: number; height: number }> {
  const e = await loadEngine();
  const svg = renderCreativeSvg(composed.composition, { visualHref: composed.dataUri, families: EXPORT_FAMILY });
  const img = render(e, svg);
  const png = img.asPng();
  const out = { png, sha256: await sha256(png), width: img.width, height: img.height };
  img.free?.();
  return out;
}
