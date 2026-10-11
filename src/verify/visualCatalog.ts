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
 * Explanations: the asset's own `explanation` first, then
 * report.visualExplanations by id, then the legacy report.visualCaptions.
 * Internal fields (documentRef, fileName, matchBasis) are read, never shown.
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
export type VisualBadge = 'PHOTO' | 'RENDER' | 'DRAWING' | 'PLAN' | 'EXACT_UNIT_PLAN' | 'TYPICAL_FLOOR_PLAN' | 'GENERAL_PLAN' | 'MATERIAL';

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
  /** CURRENT_APPROVED / HISTORICAL_APPROVED / UNDETERMINED, when the asset says. */
  versionStatus: string | null;
  /**
   * The asset concerns ANOTHER building of the project (scope PROJECT, basis
   * OTHER_BUILDING): labelled "Building <block> of the project", never as the
   * requested unit's building.
   */
  otherBuilding: boolean;
  /** i18n key of the generic caption for the kind (verify_visual_kind_<kind>). */
  captionKey: string;
  badge: VisualBadge;
  /** A drawing the reader will want to zoom into rather than glance at. */
  technical: boolean;
  /** Legacy one-line caption, when that is all the report carries. */
  title: string | null;
  /** The official case (TAS document id) the image was filed with, when known. */
  documentId: string | null;
  /** A camera's own EXIF date (photographs only), when the record carries one. */
  exifDate: string | null;
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
export function badgeFor(kind: VisualKind, scope: VisualScope | null, identityUnresolved = false, confidence: number | null = null): VisualBadge {
  // An unclassified asset is "project material" unless the classifier was
  // confident about it — and never a photo.
  if (kind === 'OTHER' && (confidence === null || confidence < 0.5)) return 'MATERIAL';
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

/** The case id an asset was filed with: the rebuilt shape's documentRef, or a stored record's own field. */
function docIdOf(o: Record<string, unknown>): string | null {
  const ref = o.documentRef && typeof o.documentRef === 'object' ? (o.documentRef as Record<string, unknown>).documentId : null;
  const id = str(ref) || str(o.documentId);
  return /^\d{3,12}$/.test(id) ? id : null;
}

/**
 * WHAT THE IMAGE IS ABOUT, said every time. The TAS record is shared by every
 * flat on the parcel, so a buyer must be told whether a picture concerns
 * their apartment, their building or the project as a whole. A missing scope
 * reads as the project — the widest, never the most flattering.
 */
export const SCOPE_KEY: Record<VisualScope, string> = {
  EXACT_UNIT: 'verify_p0_scope_exact_unit',
  TYPICAL_FLOOR: 'verify_p0_scope_typical_floor',
  BUILDING: 'verify_p0_scope_building',
  PROJECT: 'verify_p0_scope_project',
};
export function scopeKeyFor(v: Pick<CatalogVisual, 'scope' | 'badge'>, identityUnresolved = false): string {
  // An exact-unit scope is withdrawn with the label when the unit is unresolved.
  if (v.scope === 'EXACT_UNIT' && (identityUnresolved || (v.badge !== 'EXACT_UNIT_PLAN' && v.badge !== 'PHOTO'))) return SCOPE_KEY.BUILDING;
  return SCOPE_KEY[v.scope ?? 'PROJECT'];
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
  MATERIAL: 'vrx_badge_material',
};

/**
 * The server names a generic caption `verify.visual.kind.<KIND>`; the bundle's
 * keys are flat identifiers, so it lives at `verify_visual_kind_<kind>`.
 */
export function captionKeyFor(kind: VisualKind): string {
  return `verify_visual_kind_${kind.toLowerCase()}`;
}

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
  const confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : null;
  // The asset's own explanation wins over the report-level one.
  const own = o.explanation && typeof o.explanation === 'object' ? (o.explanation as RawExplanation) : null;
  const ownExp = own ? { what: str(own.what), interesting: str(own.interesting), buyerMeaning: str(own.buyerMeaning), uncertain: str(own.uncertain) } : null;
  const explanation = ownExp && (ownExp.what || ownExp.interesting || ownExp.buyerMeaning || ownExp.uncertain) ? ownExp : opts.explanation ?? null;
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
    versionStatus: str(o.versionStatus) || null,
    otherBuilding: scope === 'PROJECT' && str(o.matchBasis) === 'OTHER_BUILDING' && !!str(o.block),
    captionKey: captionKeyFor(kind),
    badge: badgeFor(kind, scope, !!opts.identityUnresolved, confidence),
    technical: !PHOTO_KINDS.has(kind) && kind !== 'RENDER',
    title: opts.title ?? null,
    documentId: docIdOf(o),
    exifDate: isoDate(o.exifDate),
    explanation,
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

/* ───────────────────────── the project's story, in pictures ───────────────────────── */

/**
 * VISUAL CHRONOLOGY (owner, 2026-10-11): the gallery tells the project's
 * story in five chapters, oldest intent to newest evidence:
 *
 *   ORIGINAL      the original concept and historical renders (renders and
 *                 unlabelled project images filed BEFORE the newest case that
 *                 holds any);
 *   DESIGNS       approved designs and revisions (every drawing and plan);
 *   CONSTRUCTION  construction progress and documented changes (construction
 *                 photographs, and photographs older than CURRENT);
 *   LATEST        the latest available renders and project images (the
 *                 newest case that holds any);
 *   CURRENT       the current documented condition: photographs filed within
 *                 CURRENT_PHOTO_MONTHS of today.
 *
 * Dates come from the official case the image was filed with (its filing
 * date) or a camera's own EXIF date; never invented. A render is never
 * evidence of completion, and where no recent photograph exists the gallery
 * says so in one sentence.
 */
export type VisualChapter = 'ORIGINAL' | 'DESIGNS' | 'CONSTRUCTION' | 'LATEST' | 'CURRENT';
export const CHAPTER_ORDER: VisualChapter[] = ['ORIGINAL', 'DESIGNS', 'CONSTRUCTION', 'LATEST', 'CURRENT'];
export const CHAPTER_KEY: Record<VisualChapter, string> = {
  ORIGINAL: 'vfv_ch_original',
  DESIGNS: 'vfv_ch_designs',
  CONSTRUCTION: 'vfv_ch_construction',
  LATEST: 'vfv_ch_latest',
  CURRENT: 'vfv_ch_current',
};
/** A photograph is "current" when filed within this many months of today. */
export const CURRENT_PHOTO_MONTHS = 24;

/** What the picture IS, said first on every card. */
export type PictureType = 'RENDER' | 'PHOTO' | 'CONSTRUCTION_PHOTO' | 'DRAWING' | 'IMAGE';
export const PICTURE_TYPE_KEY: Record<PictureType, string> = {
  RENDER: 'vfv_type_render',
  PHOTO: 'vfv_type_photo',
  CONSTRUCTION_PHOTO: 'vfv_type_construction_photo',
  DRAWING: 'vfv_type_drawing',
  IMAGE: 'vfv_type_image',
};

export function pictureTypeOf(v: Pick<CatalogVisual, 'kind' | 'badge'>): PictureType {
  if (v.kind === 'CONSTRUCTION_PHOTO') return 'CONSTRUCTION_PHOTO';
  if (v.badge === 'PHOTO') return 'PHOTO';
  if (v.badge === 'RENDER') return 'RENDER';
  if (v.badge === 'MATERIAL') return 'IMAGE';
  return 'DRAWING';
}

export interface VisualCaseInfo { caseRef?: string | null; date?: string | null }

export interface DatedLabel {
  /** i18n key of the date phrase, with its variables (month is a 1-based number as a string). */
  key: string;
  vars: Record<string, string>;
}

export interface ChronoVisual {
  visual: CatalogVisual;
  chapter: VisualChapter;
  type: PictureType;
  /** The date the picture is placed by (YYYY-MM-DD), and where it came from. */
  date: string | null;
  dateSource: 'EXIF' | 'CASE' | 'ASSET' | null;
  /** The prominent card label: type key + date phrase. */
  typeKey: string;
  dated: DatedLabel;
}

export interface VisualChronology {
  groups: Array<{ chapter: VisualChapter; items: ChronoVisual[] }>;
  /** No photograph filed within CURRENT_PHOTO_MONTHS: said plainly, once. */
  noCurrentPhotos: boolean;
  /** The newest photograph's date, when there is one (for that sentence). */
  newestPhotoDate: string | null;
}

const monthsBetween = (a: string, b: string): number => {
  const [ya, ma] = [Number(a.slice(0, 4)), Number(a.slice(5, 7))];
  const [yb, mb] = [Number(b.slice(0, 4)), Number(b.slice(5, 7))];
  return (yb - ya) * 12 + (mb - ma);
};

/** The date phrase of a card: "from the <month> <year> application", "photographed <date>", or "date not stated". */
export function datedLabel(date: string | null, source: ChronoVisual['dateSource']): DatedLabel {
  if (!date) return { key: 'vfv_date_unknown', vars: {} };
  const year = date.slice(0, 4);
  const month = String(Number(date.slice(5, 7)));
  if (source === 'EXIF') return { key: 'vfv_date_exif', vars: { date: `${date.slice(8, 10)}.${date.slice(5, 7)}.${year}` } };
  return { key: 'vfv_date_application', vars: { year, month } };
}

/**
 * Place every catalogued visual in its chapter, newest last within a chapter
 * (the story reads forward). `cases` maps a TAS document id to its case
 * (filing date). `today` is YYYY-MM-DD (injected so the rule is testable).
 */
export function visualChronology(visuals: CatalogVisual[], cases: Map<string, VisualCaseInfo> | null | undefined, today: string): VisualChronology {
  const dateOf = (v: CatalogVisual): { date: string | null; source: ChronoVisual['dateSource'] } => {
    if (v.exifDate && (v.badge === 'PHOTO')) return { date: v.exifDate, source: 'EXIF' };
    const c = v.documentId ? cases?.get(v.documentId) : undefined;
    const cd = c?.date && /^\d{4}-\d{2}-\d{2}/.test(c.date) ? c.date.slice(0, 10) : null;
    if (cd) return { date: cd, source: 'CASE' };
    if (v.date) return { date: v.date, source: 'ASSET' };
    return { date: null, source: null };
  };
  const rows = visuals.map((v) => {
    const d = dateOf(v);
    return { v, type: pictureTypeOf(v), date: d.date, source: d.source };
  });
  const isPicture = (t: PictureType) => t === 'RENDER' || t === 'IMAGE';
  const isPhoto = (t: PictureType) => t === 'PHOTO' || t === 'CONSTRUCTION_PHOTO';
  const latestPictureDate = rows.filter((r) => isPicture(r.type) && r.date).map((r) => r.date!).sort().pop() ?? null;
  const newestPhotoDate = rows.filter((r) => isPhoto(r.type) && r.date).map((r) => r.date!).sort().pop() ?? null;
  const currentPhotos = !!newestPhotoDate && monthsBetween(newestPhotoDate, today) <= CURRENT_PHOTO_MONTHS;
  const chapterOf = (r: (typeof rows)[number]): VisualChapter => {
    if (isPicture(r.type)) {
      if (r.date && latestPictureDate) return r.date === latestPictureDate ? 'LATEST' : 'ORIGINAL';
      // Undated: only the server's own LATEST_RENDER marker places it last.
      return r.v.role === 'LATEST_RENDER' && !latestPictureDate ? 'LATEST' : 'ORIGINAL';
    }
    if (isPhoto(r.type)) {
      // The newest photographs, when recent, are today's documented condition.
      if (currentPhotos && r.date && r.date.slice(0, 7) === newestPhotoDate!.slice(0, 7)) return 'CURRENT';
      return 'CONSTRUCTION';
    }
    return 'DESIGNS';
  };
  const items: ChronoVisual[] = rows.map((r) => ({
    visual: r.v,
    chapter: chapterOf(r),
    type: r.type,
    date: r.date,
    dateSource: r.source,
    typeKey: PICTURE_TYPE_KEY[r.type],
    dated: datedLabel(r.date, r.source),
  }));
  const groups = CHAPTER_ORDER.map((chapter) => ({
    chapter,
    items: items
      .filter((i) => i.chapter === chapter)
      // Oldest first; undated last; stable otherwise.
      .map((i, n) => ({ i, n }))
      .sort((a, b) => (a.i.date ?? '9999').localeCompare(b.i.date ?? '9999') || a.n - b.n)
      .map((x) => x.i),
  })).filter((g) => g.items.length > 0);
  return { groups, noCurrentPhotos: !currentPhotos, newestPhotoDate };
}
