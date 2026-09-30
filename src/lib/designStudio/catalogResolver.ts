// HOMATCH DESIGN STUDIO — the Asset Resolver: what the picture shows → one
// canonical catalogue asset.
//
// A reading never names a file, a URL or a storage path. It describes what
// it sees — "SOFA, SECTIONAL, modern, cream, fabric, ~2.8 × 1.8 m, curved,
// chaise left, living room" — and this ranks catalogue candidates and returns
// a homatchAssetId. That id is then carried unchanged through the scene, the
// editor, renders, the walkthrough, saved versions and public shares; nothing
// re-resolves it later (a replacement is an explicit editor operation).
//
// RANKING. Resemblance to the SOURCE comes first; quality only breaks near
// ties. A premium black leather rectangular sofa must lose to a standard cream
// curved fabric one when the picture shows the latter. The object type is a
// hard filter; dimensions are compared as size AND proportion, so a
// similar-looking chair at an absurd scale cannot win on tags. Provider
// preference (Poly Haven for materials and environments, Blendkit for objects)
// is a small nudge, and import order or row order never matter: equal scores
// are ordered by the asset id, which is a hash.

import { type ColorFamily, colorFamily, deltaE, hexToRgb, rgbToLab } from './catalogSource.ts';

export type Kind = 'MATERIAL' | 'MODEL' | 'ENVIRONMENT';

export interface Want {
  kind: Kind;
  objectType?: string;          // canonical subcategory family, e.g. SOFA
  subtype?: string;             // e.g. SECTIONAL_SOFA
  styles?: string[];
  color?: string;               // '#e8dcc8' or a colour word
  materials?: string[];
  sizeM?: { width?: number; depth?: number; height?: number };
  shape?: string[];             // form words: curved, round, chaise-left, l-shaped …
  room?: string;
  surface?: 'WALL' | 'FLOOR' | 'CEILING' | 'OBJECT';
  lighting?: string;            // environments: DAY, CLOUDY, SUNSET …
}

export interface Candidate {
  homatchAssetId: string;
  kind: Kind;
  sourceProvider: string;
  canonicalCategory: string;
  canonicalSubcategory: string;
  styles: string[];
  colors: string[];             // hex values and/or colour words
  materials: string[];
  aliases: string[];
  sizeM?: { width: number; depth: number; height: number } | null;
  roomKinds?: string[];
  appliesTo?: string[];
  lighting?: string | null;
  qualityTier?: 'PREMIUM' | 'STANDARD' | 'FALLBACK' | 'REJECT' | null;
  qualityScore?: number | null;
  webSuitability?: number | null;
  state?: string;               // only READY candidates are ever returned
}

export interface Ranked { homatchAssetId: string; score: number; parts: Record<string, number> }

/** The provider each kind prefers (a nudge, never a filter). */
export const PREFERRED_PROVIDER: Record<Kind, string> = { MATERIAL: 'polyhaven', ENVIRONMENT: 'polyhaven', MODEL: 'blendkit' };

const WEIGHTS = { subtype: 0.14, size: 0.22, proportion: 0.1, color: 0.18, material: 0.1, style: 0.1, shape: 0.08, room: 0.04, quality: 0.03, web: 0.01, provider: 0.02 };

const lower = (xs: string[] = []) => xs.map((x) => x.toLowerCase().replace(/[_-]+/g, ' ').trim());
const overlap = (want: string[] = [], have: string[] = []) => {
  if (!want.length) return null;
  const h = new Set(lower(have));
  return lower(want).filter((w) => h.has(w)).length / want.length;
};

function colorScore(want: string | undefined, have: string[]): number | null {
  if (!want) return null;
  const wantRgb = hexToRgb(want);
  const hexes = have.map(hexToRgb).filter((x): x is [number, number, number] => !!x);
  if (wantRgb && hexes.length) {
    const best = Math.min(...hexes.map((h) => deltaE(rgbToLab(wantRgb), rgbToLab(h))));
    return Math.max(0, 1 - best / 60); // ΔE 0 = same, ≥ 60 = unrelated
  }
  const wf = colorFamily(want);
  const hf = new Set(have.map(colorFamily).filter((x): x is ColorFamily => !!x));
  if (!wf || !hf.size) return null;
  if (hf.has(wf)) return 1;
  const near: Record<string, string[]> = {
    WHITE: ['OFF_WHITE'], OFF_WHITE: ['WHITE', 'CREAM'], CREAM: ['OFF_WHITE', 'BEIGE'], BEIGE: ['CREAM', 'BROWN', 'WOOD_LIGHT'],
    BROWN: ['BEIGE', 'WOOD_MEDIUM', 'WOOD_DARK'], BLACK: ['GRAY'], GRAY: ['BLACK', 'OFF_WHITE'], WOOD_LIGHT: ['WOOD_MEDIUM', 'BEIGE'],
    WOOD_MEDIUM: ['WOOD_LIGHT', 'WOOD_DARK', 'BROWN'], WOOD_DARK: ['WOOD_MEDIUM', 'BROWN'],
  };
  return (near[wf] ?? []).some((n) => hf.has(n as ColorFamily)) ? 0.5 : 0;
}

function sizeScores(want: Want['sizeM'], have: Candidate['sizeM']): { size: number | null; proportion: number | null } {
  if (!want || !have) return { size: null, proportion: null };
  const pairs = (['width', 'depth', 'height'] as const).filter((k) => want[k] && have[k]).map((k) => [want[k] as number, have[k]] as const);
  if (!pairs.length) return { size: null, proportion: null };
  // Relative error per axis; 35% off in any axis is no match at all.
  const err = pairs.map(([w, h]) => Math.abs(Math.log(h / w)));
  const size = Math.max(0, 1 - Math.max(...err) / Math.log(1.35));
  let proportion: number | null = null;
  if (pairs.length >= 2) {
    const r = (a: readonly [number, number], b: readonly [number, number]) => Math.abs(Math.log((a[1] / b[1]) / (a[0] / b[0])));
    const e = [];
    for (let i = 0; i < pairs.length; i += 1) for (let j = i + 1; j < pairs.length; j += 1) e.push(r(pairs[i], pairs[j]));
    proportion = Math.max(0, 1 - Math.max(...e) / Math.log(1.3));
  }
  return { size, proportion };
}

const TIER: Record<string, number> = { PREMIUM: 1, STANDARD: 0.75, FALLBACK: 0.35, REJECT: 0 };

/**
 * Candidates ranked for a want. Only READY assets of the asked kind whose
 * type matches are considered; everything that is compared contributes by
 * weight, and what the want does not say is not held against anyone (weights
 * are renormalised over the parts actually compared).
 */
export function rank(want: Want, candidates: Candidate[], limit = 5): Ranked[] {
  const out: Ranked[] = [];
  for (const c of candidates) {
    if (c.kind !== want.kind || (c.state && c.state !== 'READY') || c.qualityTier === 'REJECT') continue;
    const sub = c.canonicalSubcategory;
    if (want.objectType && !(sub === want.objectType || sub.endsWith(`_${want.objectType}`) || sub.startsWith(`${want.objectType}_`) || c.canonicalCategory.endsWith(`.${want.objectType}`))) continue;
    if (want.surface && c.appliesTo?.length && !c.appliesTo.includes(want.surface)) continue;
    const parts: Record<string, number | null> = {};
    parts.subtype = want.subtype ? (sub === want.subtype ? 1 : 0) : null;
    const s = sizeScores(want.sizeM, c.sizeM);
    parts.size = s.size;
    parts.proportion = s.proportion;
    parts.color = colorScore(want.color, c.colors);
    parts.material = overlap(want.materials, [...c.materials, ...c.aliases]);
    parts.style = overlap(want.styles, [...c.styles, ...c.aliases]);
    parts.shape = overlap(want.shape, c.aliases);
    parts.room = want.room ? (!c.roomKinds?.length || c.roomKinds.includes(want.room) ? 1 : 0) : null;
    if (want.lighting) parts.subtype = (parts.subtype ?? 0) * 0.5 + (c.lighting === want.lighting ? 0.5 : 0);
    parts.quality = c.qualityTier ? TIER[c.qualityTier] ?? 0.5 : 0.5;
    parts.web = c.webSuitability ?? 0.5;
    parts.provider = c.sourceProvider === PREFERRED_PROVIDER[want.kind] ? 1 : 0;
    let total = 0; let weight = 0;
    const kept: Record<string, number> = {};
    for (const [k, v] of Object.entries(parts)) {
      if (v === null || v === undefined) continue;
      const w = WEIGHTS[k as keyof typeof WEIGHTS];
      total += w * v; weight += w; kept[k] = Math.round(v * 1000) / 1000;
    }
    out.push({ homatchAssetId: c.homatchAssetId, score: weight ? Math.round((total / weight) * 10000) / 10000 : 0, parts: kept });
  }
  return out.sort((a, b) => b.score - a.score || (a.homatchAssetId < b.homatchAssetId ? -1 : 1)).slice(0, limit);
}
