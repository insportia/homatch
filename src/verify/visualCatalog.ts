/*
 * HOMATCH Verify — the official visuals, catalogued for the reader.
 *
 * Pure and React-free, so node --test can hold the rules that matter:
 *
 *   - ONLY signed storage URLs are ever rendered. Anything else (a portal
 *     photo, a bucket path, a data: URI) is dropped, never "fixed up".
 *   - EVERY asset carries a label. A buyer must never have to guess whether a
 *     picture is a photo of the real building or a designer's render.
 *   - A label is never UPGRADED. "Exact apartment plan" appears only when the
 *     data says the plan is scoped to this exact unit — and is withdrawn when
 *     the unit's identity is itself unresolved. A missing scope reads as the
 *     plainest honest label ("Plan"), not the most flattering one.
 *
 * Two shapes are tolerated: the rebuilt one (kind / category / scope / block /
 * page / mime …) and the original one ({ id, role, kind, date, width, height,
 * url }, kinds RENDER / FACADE / SITE_PLAN / FLOOR_PLAN / STRUCTURAL /
 * CONSTRUCTION_PHOTO / LANDSCAPE / OTHER_DRAWING). Missing fields take the
 * conservative default.
 */

export type VisualKind =
  | 'PHOTO' | 'RENDER' | 'CONSTRUCTION_PHOTO' | 'SITE_PLAN' | 'MASTER_PLAN' | 'FLOOR_PLAN' | 'UNIT_PLAN'
  | 'SECTION' | 'ELEVATION' | 'FACADE' | 'STRUCTURAL' | 'ENGINEERING' | 'LOCATION_DIAGRAM' | 'OTHER';
export type VisualCategory = 'BUILDING' | 'APARTMENT' | 'ARCHITECTURE' | 'STRUCTURE' | 'CONSTRUCTION' | 'SITE';
export type VisualScope = 'EXACT_UNIT' | 'BUILDING' | 'TYPICAL_FLOOR' | 'PROJECT';
export type VisualBadge = 'PHOTO' | 'RENDER' | 'DRAWING' | 'PLAN' | 'EXACT_UNIT_PLAN' | 'TYPICAL_FLOOR_PLAN' | 'GENERAL_PLAN';

export interface VisualExplanation {
  what: string;
  interesting: string;
  buyerMeaning: string;
  uncertain: string;
}

export interface CatalogVisual {
  id: string;
  url: string;
  kind: VisualKind;
  category: VisualCategory;
  scope: VisualScope | null;
  block: string | null;
  page: number | null;
  date: string | null;
  width: number | null;
  height: number | null;
  /** LATEST_RENDER / EARLIEST_RENDER from the original shape, when present. */
  role: string | null;
  badge: VisualBadge;
  /** A drawing the reader will want to zoom into rather than glance at. */
  technical: boolean;
  /** Legacy one-line caption, when that is all the report carries. */
  title: string | null;
  explanation: VisualExplanation | null;
}

/** Display order of the category tabs. */
export const CATEGORY_ORDER: VisualCategory[] = ['BUILDING', 'APARTMENT', 'ARCHITECTURE', 'STRUCTURE', 'CONSTRUCTION', 'SITE'];

const KINDS = new Set<VisualKind>([
  'PHOTO', 'RENDER', 'CONSTRUCTION_PHOTO', 'SITE_PLAN', 'MASTER_PLAN', 'FLOOR_PLAN', 'UNIT_PLAN',
  'SECTION', 'ELEVATION', 'FACADE', 'STRUCTURAL', 'ENGINEERING', 'LOCATION_DIAGRAM', 'OTHER',
]);
const CATEGORIES = new Set<VisualCategory>(CATEGORY_ORDER);
const SCOPES = new Set<VisualScope>(['EXACT_UNIT', 'BUILDING', 'TYPICAL_FLOOR', 'PROJECT']);

/** The original shape's kinds, mapped onto the rebuilt vocabulary. */
const LEGACY_KIND: Record<string, VisualKind> = {
  LANDSCAPE: 'SITE_PLAN',
  OTHER_DRAWING: 'OTHER',
  DRAWING: 'OTHER',
};

const DEFAULT_CATEGORY: Record<VisualKind, VisualCategory> = {
  PHOTO: 'BUILDING',
  RENDER: 'BUILDING',
  CONSTRUCTION_PHOTO: 'CONSTRUCTION',
  SITE_PLAN: 'SITE',
  MASTER_PLAN: 'SITE',
  LOCATION_DIAGRAM: 'SITE',
  FLOOR_PLAN: 'APARTMENT',
  UNIT_PLAN: 'APARTMENT',
  SECTION: 'ARCHITECTURE',
  ELEVATION: 'ARCHITECTURE',
  FACADE: 'ARCHITECTURE',
  STRUCTURAL: 'STRUCTURE',
  ENGINEERING: 'STRUCTURE',
  OTHER: 'ARCHITECTURE',
};

const PHOTO_KINDS = new Set<VisualKind>(['PHOTO', 'CONSTRUCTION_PHOTO']);
const UNIT_PLAN_KINDS = new Set<VisualKind>(['FLOOR_PLAN', 'UNIT_PLAN']);
const SITE_PLAN_KINDS = new Set<VisualKind>(['SITE_PLAN', 'MASTER_PLAN']);

/* Only signed storage URLs are rendered — a guard, not a style choice. */
export const SIGNED_STORAGE_URL = /^https:\/\/[^/\s]+\/storage\/v1\/object\/sign\/[^\s]+$/;

export function signedVisualUrl(u: unknown): string | null {
  return typeof u === 'string' && SIGNED_STORAGE_URL.test(u) ? u : null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const isoDate = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

function kindOf(raw: Record<string, unknown>): VisualKind {
  const k = str(raw.kind).toUpperCase();
  if (KINDS.has(k as VisualKind)) return k as VisualKind;
  if (LEGACY_KIND[k]) return LEGACY_KIND[k];
  // The original shape sometimes said only what ROLE a render played.
  const role = str(raw.role).toUpperCase();
  if (role === 'LATEST_RENDER' || role === 'EARLIEST_RENDER') return 'RENDER';
  return 'OTHER';
}

/**
 * The label a reader sees. Never stronger than the data: an EXACT_UNIT plan
 * whose unit identity is unresolved is shown as a plain plan.
 */
export function badgeFor(kind: VisualKind, scope: VisualScope | null, identityUnresolved = false): VisualBadge {
  if (PHOTO_KINDS.has(kind)) return 'PHOTO';
  if (kind === 'RENDER') return 'RENDER';
  if (UNIT_PLAN_KINDS.has(kind)) {
    if (scope === 'EXACT_UNIT') return identityUnresolved ? 'PLAN' : 'EXACT_UNIT_PLAN';
    if (scope === 'TYPICAL_FLOOR') return 'TYPICAL_FLOOR_PLAN';
    if (scope === 'BUILDING' || scope === 'PROJECT') return 'GENERAL_PLAN';
    return 'PLAN';
  }
  if (SITE_PLAN_KINDS.has(kind)) return 'PLAN';
  return 'DRAWING';
}

/** i18n key for every badge — one per badge, so no asset is ever unlabeled. */
export const BADGE_KEY: Record<VisualBadge, string> = {
  PHOTO: 'vrx_badge_photo',
  RENDER: 'vrx_badge_render',
  DRAWING: 'vrx_badge_drawing',
  PLAN: 'vrx_badge_plan',
  EXACT_UNIT_PLAN: 'vrx_badge_exact_unit_plan',
  TYPICAL_FLOOR_PLAN: 'vrx_badge_typical_floor_plan',
  GENERAL_PLAN: 'vrx_badge_general_plan',
};

export const CATEGORY_KEY: Record<VisualCategory, string> = {
  BUILDING: 'vrx_tab_building',
  APARTMENT: 'vrx_tab_apartment',
  ARCHITECTURE: 'vrx_tab_architecture',
  STRUCTURE: 'vrx_tab_structure',
  CONSTRUCTION: 'vrx_tab_construction',
  SITE: 'vrx_tab_site',
};

export interface LegacyCaption { visualId?: unknown; caption?: unknown; explanation?: unknown }
export interface RawExplanation { id?: unknown; what?: unknown; interesting?: unknown; buyerMeaning?: unknown; uncertain?: unknown }

/** One raw visual → a catalogued one, or null when it must not be shown. */
export function normalizeVisual(
  raw: unknown,
  opts: { explanation?: VisualExplanation | null; title?: string | null; identityUnresolved?: boolean } = {},
): CatalogVisual | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  // The rebuilt shape says `url`; a stored payload may still say `signedUrl`.
  const url = signedVisualUrl(o.url) ?? signedVisualUrl(o.signedUrl);
  if (!id || !url) return null;
  // A PDF or anything else that is not an image cannot be shown as one.
  const mime = str(o.mime).toLowerCase();
  if (mime && !mime.startsWith('image/')) return null;
  const kind = kindOf(o);
  const cat = str(o.category).toUpperCase();
  const category = CATEGORIES.has(cat as VisualCategory) ? (cat as VisualCategory) : DEFAULT_CATEGORY[kind];
  const sc = str(o.scope).toUpperCase();
  const scope = SCOPES.has(sc as VisualScope) ? (sc as VisualScope) : null;
  const page = typeof o.page === 'number' && Number.isInteger(o.page) && o.page > 0 ? o.page : null;
  return {
    id,
    url,
    kind,
    category,
    scope,
    block: str(o.block) || null,
    page,
    date: isoDate(o.date),
    width: num(o.width),
    height: num(o.height),
    role: str(o.role) || null,
    badge: badgeFor(kind, scope, !!opts.identityUnresolved),
    technical: !PHOTO_KINDS.has(kind) && kind !== 'RENDER',
    title: opts.title ?? null,
    explanation: opts.explanation ?? null,
  };
}

/**
 * The whole set: deduplicated by id, every asset labelled, explanations
 * attached from the new `visualExplanations` or, failing that, the legacy
 * `visualCaptions`.
 */
export function catalogVisuals(
  raw: unknown,
  explanations?: unknown,
  captions?: unknown,
  opts: { identityUnresolved?: boolean } = {},
): CatalogVisual[] {
  const exp = new Map<string, VisualExplanation>();
  for (const e of Array.isArray(explanations) ? (explanations as RawExplanation[]) : []) {
    const id = str(e?.id);
    if (!id) continue;
    const v = { what: str(e.what), interesting: str(e.interesting), buyerMeaning: str(e.buyerMeaning), uncertain: str(e.uncertain) };
    if (v.what || v.interesting || v.buyerMeaning || v.uncertain) exp.set(id, v);
  }
  const legacy = new Map<string, { title: string; text: string }>();
  for (const c of Array.isArray(captions) ? (captions as LegacyCaption[]) : []) {
    const id = str(c?.visualId);
    if (id) legacy.set(id, { title: str(c.caption), text: str(c.explanation) });
  }
  const out: CatalogVisual[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(raw) ? raw : []) {
    const id = str((r as Record<string, unknown> | null)?.id);
    if (!id || seen.has(id)) continue;
    const old = legacy.get(id);
    const explanation = exp.get(id) ?? (old?.text ? { what: old.text, interesting: '', buyerMeaning: '', uncertain: '' } : null);
    const v = normalizeVisual(r, { explanation, title: old?.title || null, identityUnresolved: opts.identityUnresolved });
    if (!v) continue;
    seen.add(id);
    out.push(v);
  }
  return out;
}

/** Only categories that actually hold an asset, in display order. */
export function categoryTabs(visuals: CatalogVisual[]): Array<{ category: VisualCategory; count: number }> {
  return CATEGORY_ORDER
    .map((category) => ({ category, count: visuals.filter((v) => v.category === category).length }))
    .filter((t) => t.count > 0);
}

/**
 * The image that opens the section: a photo or render of the building first
 * (a real photo before an illustrative render), then any photo or render,
 * then whatever exists.
 */
export function heroVisual(visuals: CatalogVisual[]): CatalogVisual | null {
  const rank = (v: CatalogVisual): number => {
    if (v.category === 'BUILDING' && v.kind === 'PHOTO') return 0;
    if (v.category === 'BUILDING' && v.kind === 'RENDER') return v.role === 'LATEST_RENDER' ? 1 : 2;
    if (v.kind === 'PHOTO') return 3;
    if (v.kind === 'RENDER') return 4;
    if (v.kind === 'CONSTRUCTION_PHOTO') return 5;
    return 6;
  };
  let best: CatalogVisual | null = null;
  for (const v of visuals) if (!best || rank(v) < rank(best)) best = v;
  return best;
}
