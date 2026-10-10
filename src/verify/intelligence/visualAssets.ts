// visualAssets.ts — Verify "Visual Property Intelligence": the data contract
// between the official TAS visual material and the report gallery.
//
// The worker (official-worker/src/workflows/tas/api/visualClassify.ts)
// classifies every asset deterministically and attaches IDENTITY HINTS
// (block labels, unit/floor labels, the case's cadastral codes). The TAS
// result is shared by every flat on the parcel, so the customer-facing SCOPE
// is decided here, against the unit the customer actually asked about:
//
//   EXACT_UNIT        only with the unit's own label (and its building, when
//                     the unit code names one) on a unit/floor plan;
//   TYPICAL_FLOOR     a typical-floor (or the unit's floor) plan of the
//                     unit's building;
//   BUILDING          labelled / filed for the unit's building;
//   PROJECT           the parcel's project in general (incl. other buildings);
//   UNRELATED_SUSPECT the case names a different parcel — NEVER customer-visible.
//
// Pure: no network, no clock. Safe in Edge Functions and the browser.

export type VisualAssetKind =
  | 'PHOTO'
  | 'RENDER'
  | 'CONSTRUCTION_PHOTO'
  | 'SITE_PLAN'
  | 'MASTER_PLAN'
  | 'FLOOR_PLAN'
  | 'UNIT_PLAN'
  | 'SECTION'
  | 'ELEVATION'
  | 'FACADE'
  | 'STRUCTURAL'
  | 'ENGINEERING'
  | 'LOCATION_DIAGRAM'
  | 'OTHER';

/** Gallery tabs. */
export type VisualCategory = 'BUILDING' | 'APARTMENT' | 'ARCHITECTURE' | 'STRUCTURE' | 'CONSTRUCTION' | 'SITE';

export type VisualScope = 'EXACT_UNIT' | 'BUILDING' | 'TYPICAL_FLOOR' | 'PROJECT' | 'UNRELATED_SUSPECT';

export type VisualExtraction = 'NATIVE_IMAGE' | 'PDF_EMBEDDED_IMAGE' | 'PDF_PAGE_RENDER';

/** Per-asset explanation written by synthesis (report language). */
export interface VisualExplanation {
  /** What the image shows. */
  what: string;
  /** What is notable in it. */
  interesting: string;
  /** What it means for a buyer. */
  buyerMeaning: string;
  /** What the image cannot tell (always present; renders are not built reality). */
  uncertain: string;
}

/** Provenance of an asset. Internal: the UI may cite the case, never print ids raw. */
export interface VisualDocumentRef {
  source: 'TAS';
  usage: 'OFFICIAL_RECORD_REFERENCE';
  documentId: string | null;
  attachedFileId: string | null;
  extraction: VisualExtraction | null;
}

/**
 * ONE customer-visible official visual, as the report gallery receives it.
 * `url` is always a short-lived signed URL into the PRIVATE bucket
 * (…/storage/v1/object/sign/verify-official-visuals/tas/<sha>.<ext>?token=…).
 */
export interface VerifyVisualAsset {
  /** sha256 of the image bytes (content address). */
  id: string;
  /** Signed URL (TTL 1 h). Never a public or storage path. */
  url: string;
  kind: VisualAssetKind;
  category: VisualCategory;
  scope: Exclude<VisualScope, 'UNRELATED_SUSPECT'>;
  /** Building / block id ('01', '03', 'A') when detectable. */
  block: string | null;
  /** 1-based PDF page for rendered drawing pages. */
  page: number | null;
  date: string | null;
  width: number | null;
  height: number | null;
  mime: 'image/jpeg' | 'image/png';
  fileName: string | null;
  documentRef: VisualDocumentRef;
  /** i18n key for a generic caption of the kind: `verify.visual.kind.<KIND>`. */
  captionKey?: string;
  explanation?: VisualExplanation;
  /** 0..1 classification confidence. */
  confidence: number;
  /** Why the scope was decided (audit; not for display). */
  matchBasis: string;
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING';
  versionStatus: 'CURRENT_APPROVED' | 'HISTORICAL_APPROVED' | 'UNDETERMINED';
}

/** Per-job bound on customer-visible official visuals (worker: VISUAL_ASSET_MAX). */
export const VISUAL_ASSET_MAX = 24;
export const VISUAL_BUCKET = 'verify-official-visuals';
export const VISUAL_URL_TTL_SECONDS = 3600;
export const VISUAL_STORAGE_PATH = /^tas\/[a-f0-9]{64}\.(jpg|png)$/;
const SHA = /^[a-f0-9]{64}$/;

export const VISUAL_KINDS: readonly VisualAssetKind[] = [
  'PHOTO', 'RENDER', 'CONSTRUCTION_PHOTO', 'SITE_PLAN', 'MASTER_PLAN', 'FLOOR_PLAN', 'UNIT_PLAN', 'SECTION', 'ELEVATION', 'FACADE',
  'STRUCTURAL', 'ENGINEERING', 'LOCATION_DIAGRAM', 'OTHER',
];

export const CATEGORY_OF_KIND: Record<VisualAssetKind, VisualCategory> = {
  PHOTO: 'BUILDING',
  RENDER: 'BUILDING',
  CONSTRUCTION_PHOTO: 'CONSTRUCTION',
  SITE_PLAN: 'SITE',
  MASTER_PLAN: 'SITE',
  LOCATION_DIAGRAM: 'SITE',
  FLOOR_PLAN: 'ARCHITECTURE',
  UNIT_PLAN: 'APARTMENT',
  SECTION: 'ARCHITECTURE',
  ELEVATION: 'ARCHITECTURE',
  FACADE: 'ARCHITECTURE',
  STRUCTURAL: 'STRUCTURE',
  ENGINEERING: 'STRUCTURE',
  OTHER: 'BUILDING',
};

/** Older worker vocabulary (≤ 2026-10-10) → current kinds. */
const LEGACY_KIND: Record<string, VisualAssetKind> = { LANDSCAPE: 'SITE_PLAN', OTHER_DRAWING: 'OTHER' };

export function normalizeVisualKind(k: unknown): VisualAssetKind {
  const s = String(k ?? '').toUpperCase();
  if ((VISUAL_KINDS as readonly string[]).includes(s)) return s as VisualAssetKind;
  return LEGACY_KIND[s] ?? 'OTHER';
}

const CATEGORIES: readonly VisualCategory[] = ['BUILDING', 'APARTMENT', 'ARCHITECTURE', 'STRUCTURE', 'CONSTRUCTION', 'SITE'];
export function normalizeVisualCategory(c: unknown, kind: VisualAssetKind): VisualCategory {
  const s = String(c ?? '').toUpperCase();
  return (CATEGORIES as readonly string[]).includes(s) ? (s as VisualCategory) : CATEGORY_OF_KIND[kind];
}

// ─────────────────────────── identity ───────────────────────────

export interface VisualSubject {
  /** The unit (or parcel) the customer asked about. */
  cadastralCode: string | null;
  /** First five segments: the parcel TAS answers for. */
  parcel: string | null;
  /** Building segment of a unit code ('03'), when present. */
  building: string | null;
  /** Apartment / unit number ('503'). */
  unitNumber: string | null;
  floor: string | null;
}

const pad2 = (s: string): string => (/^\d$/.test(s) ? `0${s}` : s.toUpperCase());
const num = (s: unknown): string | null => {
  const m = /\d{1,4}/.exec(String(s ?? ''));
  return m ? String(Number(m[0])) : null;
};

/**
 * 01.18.06.019.055.03.01.503 → parcel 01.18.06.019.055, building 03, unit
 * 503. The unit/floor from the register win over the code's last segment.
 */
export function visualSubject(code: unknown, extra: { unitNumber?: unknown; floor?: unknown } = {}): VisualSubject {
  const c = String(code ?? '').trim();
  const seg = /^\d{1,3}(\.\d{1,4}){2,}$/.test(c) ? c.split('.') : [];
  return {
    cadastralCode: c || null,
    parcel: seg.length >= 5 ? seg.slice(0, 5).join('.') : seg.length ? c : null,
    building: seg.length >= 6 ? pad2(seg[5]) : null,
    unitNumber: num(extra.unitNumber) ?? (seg.length >= 8 ? num(seg[seg.length - 1]) : null),
    floor: num(extra.floor),
  };
}

export interface VisualIdentity {
  blocks?: string[];
  unitLabels?: string[];
  floorLabels?: string[];
  typicalFloor?: boolean;
  caseCadastralCodes?: string[];
  blockBasis?: 'LABEL' | 'CASE_CADASTRAL' | null;
}

export function sameParcel(code: string, parcel: string): boolean {
  return code === parcel || code.startsWith(`${parcel}.`) || parcel.startsWith(`${code}.`);
}

const PLAN_KINDS = new Set<VisualAssetKind>(['FLOOR_PLAN', 'UNIT_PLAN']);

export function resolveVisualScope(
  kind: VisualAssetKind,
  identity: VisualIdentity | null | undefined,
  subject: VisualSubject,
): { scope: VisualScope; block: string | null; matchBasis: string } {
  const id = identity ?? {};
  const blocks = (id.blocks ?? []).map((b) => pad2(String(b)));
  const block = blocks.length === 1 ? blocks[0] : null;
  const codes = (id.caseCadastralCodes ?? []).map(String).filter(Boolean);
  if (subject.parcel && codes.length && !codes.some((c) => sameParcel(c, subject.parcel!)))
    return { scope: 'UNRELATED_SUSPECT', block, matchBasis: 'CASE_CADASTRAL_OTHER_PARCEL' };

  const sameBuilding = !!(subject.building && block && block === subject.building);
  const otherBuilding = !!(subject.building && block && block !== subject.building);
  // A unit code names its building: without the same building on the asset,
  // a label match proves nothing about THIS flat.
  const buildingOk = subject.building ? sameBuilding : !otherBuilding && blocks.length <= 1;
  const plan = PLAN_KINDS.has(kind);
  const units = (id.unitLabels ?? []).map((u) => num(u)).filter(Boolean) as string[];
  const floors = (id.floorLabels ?? []).map((f) => num(f)).filter(Boolean) as string[];

  if (plan && buildingOk && subject.unitNumber && units.includes(subject.unitNumber))
    return { scope: 'EXACT_UNIT', block, matchBasis: subject.building ? 'UNIT_LABEL+BLOCK' : 'UNIT_LABEL' };
  if (plan && buildingOk && id.typicalFloor) return { scope: 'TYPICAL_FLOOR', block, matchBasis: 'TYPICAL_FLOOR_LABEL' };
  if (plan && buildingOk && subject.floor && floors.includes(subject.floor)) return { scope: 'TYPICAL_FLOOR', block, matchBasis: 'FLOOR_LABEL' };
  if (sameBuilding) return { scope: 'BUILDING', block, matchBasis: id.blockBasis === 'CASE_CADASTRAL' ? 'CASE_CADASTRAL_BUILDING' : 'BLOCK_LABEL' };
  if (otherBuilding) return { scope: 'PROJECT', block, matchBasis: 'OTHER_BUILDING' };
  return { scope: 'PROJECT', block, matchBasis: codes.length ? 'PARCEL_CASE' : 'TAS_PARCEL_SEARCH' };
}

/** Plans proven to concern the unit or its floor belong on the APARTMENT tab. */
export function categoryForScope(kind: VisualAssetKind, category: VisualCategory, scope: VisualScope): VisualCategory {
  if (PLAN_KINDS.has(kind) && (scope === 'EXACT_UNIT' || scope === 'TYPICAL_FLOOR')) return 'APARTMENT';
  return category;
}

export function isCustomerVisibleScope(scope: VisualScope): scope is Exclude<VisualScope, 'UNRELATED_SUSPECT'> {
  return scope !== 'UNRELATED_SUSPECT';
}

// ─────────────────────────── serialization ───────────────────────────

export function storagePathFor(id: string, mime: unknown): string | null {
  if (!SHA.test(id)) return null;
  return `tas/${id}.${mime === 'image/png' ? 'png' : 'jpg'}`;
}

/** Only a signed object URL of the private bucket is ever handed to a customer. */
export function isSignedVisualUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const local = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|kong|host\.docker\.internal)$/.test(u.hostname);
    return (u.protocol === 'https:' || local) && u.pathname.includes(`/storage/v1/object/sign/${VISUAL_BUCKET}/tas/`) && u.searchParams.has('token');
  } catch {
    return false;
  }
}

/** The intelligence layer's per-visual view (tasIntelligence VisualRef subset). */
export interface VisualMeta {
  id: string;
  role?: VerifyVisualAsset['role'];
  kind?: string;
  category?: string;
  scope?: VisualScope;
  block?: string | null;
  matchBasis?: string;
  page?: number | null;
  date?: string | null;
  width?: number | null;
  height?: number | null;
  mime?: string | null;
  fileName?: string | null;
  confidence?: number | null;
  versionStatus?: VerifyVisualAsset['versionStatus'];
  documentId?: string | null;
  attachedFileId?: string | null;
  extraction?: string | null;
}

/**
 * The bucket records to persist with the report: the stored visuals
 * (storagePath) that the intelligence layer kept (customer-visible), in its
 * order, carrying its scope/category. Bounded.
 */
export function persistableVisuals(stored: unknown, kept: VisualMeta[], max = VISUAL_ASSET_MAX): Array<Record<string, unknown>> {
  const byId = new Map<string, any>();
  for (const v of Array.isArray(stored) ? stored : []) if (v && SHA.test(String(v.id))) byId.set(String(v.id), v);
  const out: Array<Record<string, unknown>> = [];
  for (const m of kept) {
    const s = byId.get(m.id);
    if (!s || m.scope === 'UNRELATED_SUSPECT') continue;
    const path = typeof s.storagePath === 'string' && VISUAL_STORAGE_PATH.test(s.storagePath) ? s.storagePath : null;
    if (!path) continue;
    out.push({
      ...s,
      storagePath: path,
      kind: m.kind ?? s.kind,
      category: m.category ?? s.category ?? null,
      scope: m.scope ?? 'PROJECT',
      block: m.block ?? null,
      matchBasis: m.matchBasis ?? null,
      page: m.page ?? s.page ?? null,
      confidence: m.confidence ?? s.confidence ?? null,
      versionStatus: m.versionStatus ?? 'UNDETERMINED',
      role: m.role ?? s.role ?? 'SUPPORTING',
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Signs many bucket paths; returns path → signed URL (or null). */
export type VisualSigner = (paths: string[], ttlSeconds: number) => Promise<Record<string, string | null>>;

/**
 * Persisted visual records → customer assets. Drops anything without a valid
 * content-addressed path, anything hidden (UNRELATED_SUSPECT), anything whose
 * signed URL is missing or not a private-bucket signed URL. Bounded.
 */
export async function toCustomerVisualAssets(
  records: unknown,
  sign: VisualSigner,
  opts: { explanations?: unknown; max?: number; ttlSeconds?: number } = {},
): Promise<VerifyVisualAsset[]> {
  const max = Math.min(opts.max ?? VISUAL_ASSET_MAX, VISUAL_ASSET_MAX);
  const list = (Array.isArray(records) ? records : [])
    .filter((v: any) => v && SHA.test(String(v.id)) && typeof v.storagePath === 'string' && VISUAL_STORAGE_PATH.test(v.storagePath))
    .filter((v: any) => v.scope !== 'UNRELATED_SUSPECT')
    .slice(0, max);
  if (!list.length) return [];
  let urls: Record<string, string | null> = {};
  try {
    urls = await sign(list.map((v: any) => v.storagePath), opts.ttlSeconds ?? VISUAL_URL_TTL_SECONDS);
  } catch {
    return [];
  }
  const expl = new Map<string, VisualExplanation>();
  for (const e of Array.isArray(opts.explanations) ? opts.explanations : []) {
    const id = String((e as any)?.id ?? '');
    if (!SHA.test(id)) continue;
    const field = (k: string) => String((e as any)?.[k] ?? '').trim().slice(0, 600);
    if (field('what')) expl.set(id, { what: field('what'), interesting: field('interesting'), buyerMeaning: field('buyerMeaning'), uncertain: field('uncertain') });
  }
  const seen = new Set<string>();
  const out: VerifyVisualAsset[] = [];
  for (const v of list as any[]) {
    if (seen.has(v.id)) continue;
    const url = urls[v.storagePath];
    if (!isSignedVisualUrl(url)) continue;
    seen.add(v.id);
    const kind = normalizeVisualKind(v.kind);
    const scope: VisualScope = ['EXACT_UNIT', 'BUILDING', 'TYPICAL_FLOOR', 'PROJECT'].includes(v.scope) ? v.scope : 'PROJECT';
    const category = categoryForScope(kind, normalizeVisualCategory(v.category, kind), scope);
    const n = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
    out.push({
      id: v.id,
      url,
      kind,
      category,
      scope: scope as VerifyVisualAsset['scope'],
      block: typeof v.block === 'string' && v.block ? v.block : null,
      page: n(v.page),
      date: typeof v.date === 'string' ? v.date.slice(0, 10) : null,
      width: n(v.width),
      height: n(v.height),
      mime: v.storagePath.endsWith('.png') ? 'image/png' : 'image/jpeg',
      fileName: typeof v.fileName === 'string' ? v.fileName.slice(0, 200) : null,
      documentRef: {
        source: 'TAS',
        usage: 'OFFICIAL_RECORD_REFERENCE',
        documentId: v.documentId ? String(v.documentId) : null,
        attachedFileId: v.attachedFileId ? String(v.attachedFileId) : null,
        extraction: ['NATIVE_IMAGE', 'PDF_EMBEDDED_IMAGE', 'PDF_PAGE_RENDER'].includes(v.extraction) ? v.extraction : null,
      },
      captionKey: `verify.visual.kind.${kind}`,
      ...(expl.has(v.id) ? { explanation: expl.get(v.id)! } : {}),
      confidence: Number.isFinite(Number(v.confidence)) ? Math.max(0, Math.min(1, Number(v.confidence))) : 0.5,
      matchBasis: typeof v.matchBasis === 'string' ? v.matchBasis : 'TAS_PARCEL_SEARCH',
      role: v.role === 'LATEST_RENDER' || v.role === 'EARLIEST_RENDER' ? v.role : 'SUPPORTING',
      versionStatus: v.versionStatus === 'CURRENT_APPROVED' || v.versionStatus === 'HISTORICAL_APPROVED' ? v.versionStatus : 'UNDETERMINED',
    });
  }
  return out;
}
