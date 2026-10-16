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

import { correctVisualKind } from './intelligence/visualAssets.ts';
import { freshPhotoViews, sanitizeVisualDates, visualDates, type FreshPhotoView, type VisualDates } from './intelligence/visualDates.ts';

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
  /** The official file name: read for its date and kind, never displayed raw. */
  fileName: string | null;
  explanation: VisualExplanation | null;
  /** The case the image was filed with (AR…), when the record carries it (visualDates.ts). */
  caseRef?: string | null;
  /** Provenance dates written at build time (visualDates.ts), re-validated; null on older records. */
  dates?: VisualDates | null;
  /** Set only for a fresh photo found outside the official record (synthesis_json.freshPhotos). */
  fresh?: FreshPhotoView | null;
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
  // "fotomontaji …" stored as PHOTO is a render (visualAssets.ts, file-name evidence).
  const kind = correctVisualKind(kindOf(o), o.fileName) as VisualKind;
  const cat = str(o.category).toUpperCase();
  const category = kind === 'RENDER' ? 'BUILDING' : CATEGORIES.has(cat as VisualCategory) ? (cat as VisualCategory) : DEFAULT_CATEGORY[kind];
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
    fileName: str(o.fileName).slice(0, 200) || null,
    explanation,
    caseRef: /^[A-Z]{1,4}\d{3,14}$/.test(str(o.caseRef)) ? str(o.caseRef) : null,
    dates: sanitizeVisualDates(o.dates),
    fresh: null,
  };
}

/**
 * synthesis_json.freshPhotos → catalogued photographs. Only accepted photos
 * with a signed storage URL (added at read time) are shown; each keeps its
 * source, author, license, capture and publication dates (FreshPhotoView).
 */
export function catalogFreshPhotos(raw: unknown, opts: { today?: string | null } = {}): CatalogVisual[] {
  const out: CatalogVisual[] = [];
  for (const p of freshPhotoViews(raw, opts)) {
    const url = signedVisualUrl(p.url);
    if (!url) continue;
    const scope: VisualScope = p.scope === 'DEVELOPMENT' ? 'PROJECT' : 'BUILDING';
    out.push({
      id: `fresh:${p.id}`,
      url,
      kind: 'PHOTO',
      category: 'BUILDING',
      scope,
      block: null,
      page: null,
      date: null,
      width: p.width,
      height: p.height,
      role: null,
      versionStatus: null,
      otherBuilding: false,
      captionKey: captionKeyFor('PHOTO'),
      badge: 'PHOTO',
      technical: false,
      title: null,
      documentId: null,
      exifDate: null,
      fileName: null,
      explanation: null,
      caseRef: null,
      dates: { capture: p.capture, document: null },
      fresh: p,
    });
  }
  return out;
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


/* ───────────────────────── the gallery's tabs: what is true when ───────────────────────── */

/**
 * VISUAL EVOLUTION (owner, 2026-10-11; v7 dating, same day): five tabs,
 * newest first, only those that hold something:
 *
 *   LATEST_PHOTOS  უახლესი ფოტოები  the newest photographs we hold, by a
 *                                   VERIFIED capture date (camera EXIF, a
 *                                   provider's capture date), else by the
 *                                   date of the material they were filed in.
 *                                   Never a render. A photo is never called
 *                                   "today" or "current": the tab header says
 *                                   which case applies (newest verified, or
 *                                   last available with its year).
 *   LATEST         ბოლო პროექტი     the newest DATED design images (renders,
 *                                   photomontages, unlabelled project
 *                                   pictures) filed within HISTORICAL_YEARS.
 *                                   Never an undated one, never an old one,
 *                                   whatever its role or file name says.
 *   CHANGES        ცვლილებები       earlier design versions and photographs
 *                                   of the last HISTORICAL_YEARS, and
 *                                   undated pictures (marked, last).
 *   OLD            ძველი ვერსიები    pictures dated HISTORICAL_YEARS or more
 *                                   ago, each with the mandatory historical
 *                                   label on and above the image.
 *   DRAWINGS       ნახაზები         plans, sections, facades, structure, site.
 *
 * Dates come from visualDates.ts: a capture date ONLY from EXIF / provider
 * capture; a file-name date or case filing date is a DOCUMENT date (when the
 * material was submitted), never a capture date.
 */
export type VisualChapter = 'LATEST_PHOTOS' | 'LATEST' | 'CHANGES' | 'OLD' | 'DRAWINGS';
export const CHAPTER_ORDER: VisualChapter[] = ['LATEST_PHOTOS', 'LATEST', 'CHANGES', 'OLD', 'DRAWINGS'];
export const CHAPTER_KEY: Record<VisualChapter, string> = {
  LATEST_PHOTOS: 'vev_tab_latest_photos',
  LATEST: 'vev_tab_latest',
  CHANGES: 'vev_tab_changes',
  OLD: 'vev_tab_old',
  DRAWINGS: 'vev_tab_drawings',
};
/** Why a picture in this tab matters, when synthesis wrote no buyer meaning for it. */
export const CHAPTER_WHY_KEY: Record<VisualChapter, string> = {
  LATEST_PHOTOS: 'vg_why_latest_photos',
  LATEST: 'vev_why_latest',
  CHANGES: 'vev_why_changes',
  OLD: 'vev_why_old',
  DRAWINGS: 'vev_why_drawings',
};
/** A verified capture this recent may be called "the newest photos of the building". */
export const CURRENT_PHOTO_MONTHS = 24;
/** Photographs within this many days of the newest one share the latest-photos tab. */
export const LATEST_PHOTO_WINDOW_DAYS = 90;
/** Pictures dated this many years ago or more are history, not the current project. */
export const HISTORICAL_YEARS = 5;

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

export type DateSource = 'EXIF' | 'PROVIDER_CAPTURE' | 'FILENAME' | 'CASE' | 'ASSET';

/** How a photograph is dated: a verified capture, only an archival (document) date, or nothing. */
export type PhotoDating = 'CAPTURED' | 'ARCHIVAL' | 'UNKNOWN';

/** The mandatory label of a historical picture: on the image and above it, with its supporting copy. */
export interface HistoricalLabel {
  /** "ძველი საპროექტო ვერსია | {{year}} წელი" (render), or its photograph / image counterpart. */
  badgeKey: string;
  noteKey: string;
  vars: { year: string };
}

export interface ChronoVisual {
  visual: CatalogVisual;
  chapter: VisualChapter;
  type: PictureType;
  /** The date the picture is placed by (YYYY-MM-DD), and where it came from. */
  date: string | null;
  dateSource: DateSource | null;
  /** The provenance dates (visualDates.ts): capture and document, never confused. */
  dates: VisualDates;
  caseRef: string | null;
  /** The prominent card label: type key + date phrase. */
  typeKey: string;
  /** The card's date line. */
  dated: DatedLabel;
  /** Photographs only. */
  photoDating: PhotoDating | null;
  /** "{{year}} წლის საარქივო ფოტო": replaces the type in the label of an archival photograph. */
  photoLabel: DatedLabel | null;
  /**
   * Supporting lines under the date. `vars.date` of vg_archival_note is an
   * ISO date the UI phrases per language (documentDatePhrase).
   */
  notes: DatedLabel[];
  /** Set for every picture in OLD (its date is verified by construction). */
  historical: HistoricalLabel | null;
}

export interface LatestPhotosHeader {
  /** NEWEST_VERIFIED: every photo in the tab has a verified, recent capture date. */
  kind: 'NEWEST_VERIFIED' | 'LAST_AVAILABLE';
  titleKey: string;
  bodyKey: string;
  /** "უახლესი მოძიებული ფოტო | {{year}} წელი" when that year is before the current one. */
  badge: { key: string; noteKey: string; vars: { year: string } } | null;
}

export interface VisualChronology {
  groups: Array<{ chapter: VisualChapter; items: ChronoVisual[] }>;
  /** The tab the gallery opens on: the newest photographs, else the newest verified category. */
  defaultChapter: VisualChapter | null;
  /** The opening image: the newest photograph (a verified fresh one first); never an old render. */
  hero: CatalogVisual | null;
  /** What the latest-photos tab header says; null when it does not exist. */
  latestPhotos: LatestPhotosHeader | null;
  /** No recent photograph with a VERIFIED capture date. */
  noCurrentPhotos: boolean;
  /** The newest photograph's placing date (capture, else document), when there is one. */
  newestPhotoDate: string | null;
  /** Historical renders exist and no newer verified render does ("განახლებული რენდერი ვერ მოიძებნა"). */
  noNewerRender: boolean;
}

const DAY_MS = 864e5;
const monthsBetween = (a: string, b: string): number => {
  const [ya, ma] = [Number(a.slice(0, 4)), Number(a.slice(5, 7))];
  const [yb, mb] = [Number(b.slice(0, 4)), Number(b.slice(5, 7))];
  return (yb - ya) * 12 + (mb - ma);
};
const yearsBetween = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / (365.25 * DAY_MS);
const dmyOf = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/** The date phrase of a design image or drawing: "from the <month> <year> application", "photographed <date>", "<date> in the file name", or "date not stated". */
export function datedLabel(date: string | null, source: ChronoVisual['dateSource']): DatedLabel {
  if (!date) return { key: 'vfv_date_unknown', vars: {} };
  const year = date.slice(0, 4);
  const month = String(Number(date.slice(5, 7)));
  if (source === 'EXIF' || source === 'PROVIDER_CAPTURE') return { key: 'vfv_date_exif', vars: { date: dmyOf(date) } };
  if (source === 'FILENAME') return { key: 'vev_date_filename', vars: { date: dmyOf(date) } };
  return { key: 'vfv_date_application', vars: { year, month } };
}

/**
 * A photograph's date line, label and notes (owner-approved copy):
 *   CAPTURED  "photographed DD.MM.YYYY"
 *   ARCHIVAL  "ფოტოს გადაღების თარიღი უცნობია", labelled "{{year}} წლის საარქივო
 *             ფოტო", with the note that the materials are dated {{date}}
 *   UNKNOWN   "ფოტოს გადაღების თარიღი უცნობია" and its explanation only
 */
export function photoDatedLabel(dates: VisualDates): { dating: PhotoDating; dated: DatedLabel; label: DatedLabel | null; notes: DatedLabel[] } {
  if (dates.capture) return { dating: 'CAPTURED', dated: { key: 'vfv_date_exif', vars: { date: dmyOf(dates.capture.date) } }, label: null, notes: [] };
  if (dates.document) {
    return {
      dating: 'ARCHIVAL',
      dated: { key: 'vg_capture_unknown_title', vars: {} },
      label: { key: 'vg_archival_photo', vars: { year: dates.document.date.slice(0, 4) } },
      notes: [{ key: 'vg_archival_note', vars: { date: dates.document.date } }],
    };
  }
  return { dating: 'UNKNOWN', dated: { key: 'vg_capture_unknown_title', vars: {} }, label: null, notes: [{ key: 'vg_capture_unknown_body', vars: {} }] };
}

const HISTORICAL_KEYS: Record<PictureType, { badgeKey: string; noteKey: string }> = {
  RENDER: { badgeKey: 'vev_hist_render_badge', noteKey: 'vev_hist_render_note' },
  IMAGE: { badgeKey: 'vev_hist_image_badge', noteKey: 'vev_hist_image_note' },
  PHOTO: { badgeKey: 'vev_hist_photo_badge', noteKey: 'vev_hist_photo_note' },
  CONSTRUCTION_PHOTO: { badgeKey: 'vev_hist_photo_badge', noteKey: 'vev_hist_photo_note' },
  DRAWING: { badgeKey: 'vev_hist_image_badge', noteKey: 'vev_hist_image_note' },
};

/**
 * Place every catalogued visual in its tab, newest first within a tab.
 * `cases` maps a TAS document id to its case (caseRef, filing date). `today`
 * is YYYY-MM-DD (injected so the rule is testable). Fresh photos
 * (catalogFreshPhotos) are passed in the same list.
 */
export function visualChronology(visuals: CatalogVisual[], cases: Map<string, VisualCaseInfo> | null | undefined, today: string): VisualChronology {
  const caseMap = cases ?? new Map<string, VisualCaseInfo>();
  const isPicture = (t: PictureType) => t === 'RENDER' || t === 'IMAGE';
  const isPhoto = (t: PictureType) => t === 'PHOTO' || t === 'CONSTRUCTION_PHOTO';
  const rows = visuals.map((v, n) => {
    const type = pictureTypeOf(v);
    const own = v.fresh
      ? { caseRef: null, dates: { capture: v.fresh.capture, document: null } as VisualDates }
      : visualDates(v, caseMap, { today });
    const dates = own.dates;
    let date: string | null = null;
    let source: DateSource | null = null;
    if (dates.capture && isPhoto(type)) { date = dates.capture.date; source = dates.capture.source === 'EXIF' ? 'EXIF' : 'PROVIDER_CAPTURE'; }
    else if (dates.document) { date = dates.document.date; source = dates.document.source === 'FILE_NAME' ? 'FILENAME' : 'CASE'; }
    // An asset's own unexplained date may order a drawing or render; it never dates a photograph.
    else if (v.date && !isPhoto(type) && v.date <= today) { date = v.date; source = 'ASSET'; }
    const captured = isPhoto(type) && !!dates.capture;
    return { v, n, type, date, source, dates: isPhoto(type) ? dates : { capture: null, document: dates.document }, caseRef: own.caseRef, captured };
  });
  type Row = (typeof rows)[number];
  const old = (d: string | null) => !!d && yearsBetween(d, today) >= HISTORICAL_YEARS;

  /* ── the newest photographs ── */
  const photos = rows.filter((r) => isPhoto(r.type) && r.date);
  const maxOf = (list: Row[]) => list.map((r) => r.date!).sort().pop() ?? null;
  const vMax = maxOf(photos.filter((r) => r.captured));
  const dMax = maxOf(photos.filter((r) => !r.captured));
  const minus = (d: string, days: number) => new Date(Date.parse(d) - days * DAY_MS).toISOString().slice(0, 10);
  const latestPhotoIds = new Set<Row>();
  let header: LatestPhotosHeader | null = null;
  const newestPhotoDate = maxOf(photos);
  if (vMax && (!dMax || vMax >= dMax)) {
    // A verified capture is the newest: only verified photographs share the tab.
    for (const r of photos) if (r.captured && r.date! >= minus(vMax, LATEST_PHOTO_WINDOW_DAYS)) latestPhotoIds.add(r);
  } else if (dMax) {
    // Only document dates (or older captures): the newest material's photographs.
    for (const r of photos) if (r.date! >= minus(dMax, LATEST_PHOTO_WINDOW_DAYS)) latestPhotoIds.add(r);
  }
  if (latestPhotoIds.size) {
    const all = [...latestPhotoIds];
    const allVerified = all.every((r) => r.captured);
    const newest = maxOf(all)!;
    const recent = monthsBetween(newest, today) <= CURRENT_PHOTO_MONTHS;
    const year = newest.slice(0, 4);
    header = allVerified && recent
      ? { kind: 'NEWEST_VERIFIED', titleKey: 'vg_photos_fresh_title', bodyKey: 'vg_photos_fresh_body', badge: null }
      : {
          kind: 'LAST_AVAILABLE',
          titleKey: 'vg_photos_last_title',
          bodyKey: 'vg_photos_last_body',
          badge: Number(year) < Number(today.slice(0, 4)) ? { key: 'vg_photos_badge', noteKey: 'vg_photos_badge_note', vars: { year } } : null,
        };
  }

  /* ── the newest design ── */
  const latestPictureDate = rows.filter((r) => isPicture(r.type) && r.date && !old(r.date)).map((r) => r.date!).sort().pop() ?? null;

  const chapterOf = (r: Row): VisualChapter => {
    if (isPicture(r.type)) {
      if (old(r.date)) return 'OLD';
      // The newest dated design (filed within ~6 weeks of the newest one). An
      // undated picture is never "the latest", whatever its role says.
      if (r.date && latestPictureDate) return Date.parse(r.date) >= Date.parse(latestPictureDate) - 45 * DAY_MS ? 'LATEST' : 'CHANGES';
      return 'CHANGES';
    }
    if (isPhoto(r.type)) {
      if (latestPhotoIds.has(r)) return 'LATEST_PHOTOS';
      if (old(r.date)) return 'OLD';
      return 'CHANGES';
    }
    return 'DRAWINGS';
  };
  const items: Array<ChronoVisual & { _n: number; _captured: boolean }> = rows.map((r) => {
    const chapter = chapterOf(r);
    const photo = isPhoto(r.type) ? photoDatedLabel(r.dates) : null;
    return {
      // Outside the latest-design tab nothing may call itself the latest (v7).
      visual: chapter === 'LATEST' ? r.v : withoutLatestClaims(r.v),
      chapter,
      type: r.type,
      date: r.date,
      dateSource: r.source,
      dates: r.dates,
      caseRef: r.caseRef,
      typeKey: PICTURE_TYPE_KEY[r.type],
      dated: photo ? photo.dated : datedLabel(r.date, r.source),
      photoDating: photo ? photo.dating : null,
      photoLabel: photo ? photo.label : null,
      notes: photo ? photo.notes : [],
      historical: chapter === 'OLD' && r.date ? { ...HISTORICAL_KEYS[r.type], vars: { year: r.date.slice(0, 4) } } : null,
      _n: r.n,
      _captured: r.captured,
    };
  });
  const typeRank: Record<PictureType, number> = { RENDER: 0, PHOTO: 1, CONSTRUCTION_PHOTO: 1, IMAGE: 2, DRAWING: 3 };
  const groups = CHAPTER_ORDER.map((chapter) => ({
    chapter,
    items: items
      .filter((i) => i.chapter === chapter)
      .sort((a, b) =>
        // Latest photos: verified captures first (a fresh one before an official one).
        (chapter === 'LATEST_PHOTOS' ? Number(b._captured) - Number(a._captured) || Number(!!b.visual.fresh) - Number(!!a.visual.fresh) : 0) ||
        // Newest first; undated last, marked; renders and photographs before unlabelled pictures; stable otherwise.
        (b.date ?? '0000').localeCompare(a.date ?? '0000') || typeRank[a.type] - typeRank[b.type] || a._n - b._n)
      .map(({ _n, _captured, ...i }) => i as ChronoVisual),
  })).filter((g) => g.items.length > 0);
  const has = (c: VisualChapter) => groups.some((g) => g.chapter === c);
  const defaultChapter: VisualChapter | null = (['LATEST_PHOTOS', 'LATEST', 'CHANGES', 'DRAWINGS', 'OLD'] as VisualChapter[]).find(has) ?? null;
  const first = (c: VisualChapter | null) => (c ? groups.find((g) => g.chapter === c)?.items[0]?.visual ?? null : null);
  const hero = first(defaultChapter);
  const oldRenders = items.some((i) => i.chapter === 'OLD' && i.type === 'RENDER');
  const newerRenders = items.some((i) => i.chapter !== 'OLD' && i.type === 'RENDER');
  return {
    groups,
    defaultChapter,
    hero,
    latestPhotos: header,
    noCurrentPhotos: header?.kind !== 'NEWEST_VERIFIED',
    newestPhotoDate,
    noNewerRender: oldRenders && !newerRenders,
  };
}

/** "Newest / latest" wording, in the six report languages. */
const LATEST_CLAIM = /(უახლეს|ბოლო\s+საპროექტო|\blatest\b|\bnewest\b|\bmost recent\b|последн|новейш|en son|en yeni|الأحدث|الأخير|האחרונ|העדכני)/i;

/**
 * A visual that is not in the latest-design tab, with every sentence that
 * calls it the latest removed from its explanation and its LATEST_RENDER
 * role demoted (job eeefada9: a 2013 render captioned "უახლესი რენდერი").
 */
export function withoutLatestClaims(v: CatalogVisual): CatalogVisual {
  const strip = (t: string | undefined | null): string => String(t ?? '').split(/(?<=[.!?։])\s+/).filter((x) => x.trim() && !LATEST_CLAIM.test(x)).join(' ').trim();
  const e = v.explanation;
  const title = v.title && LATEST_CLAIM.test(v.title) ? null : v.title;
  const explanation = e ? { ...e, what: strip(e.what), interesting: strip(e.interesting), buyerMeaning: strip(e.buyerMeaning), uncertain: e.uncertain } : e;
  const role = v.role === 'LATEST_RENDER' ? 'SUPPORTING' : v.role;
  if (role === v.role && title === v.title && JSON.stringify(explanation) === JSON.stringify(e)) return v;
  return { ...v, role, title, explanation } as CatalogVisual;
}
