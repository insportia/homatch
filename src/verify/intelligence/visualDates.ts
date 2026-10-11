/*
 * HOMATCH Verify — WHEN a picture is from, and what kind of "when" that is.
 *
 * Pure, React-free and Deno-safe: verify-synthesis attaches the result to
 * every officialVisuals record at build time, and the gallery derives the
 * same thing on read for records stored before that (visualCatalog.ts).
 *
 * Two different dates, never confused:
 *
 *   capture   the moment the camera took the picture. ONLY from the camera's
 *             own EXIF (official photographs) or the provider's stated
 *             capture date (fresh photos). Never inferred from an upload, a
 *             filing, a publication or a file name.
 *   document  the date of the official material the picture was found in:
 *             a date the file name states ("ფოტო 14-04-2025.pdf") or the
 *             case filing date it was joined to through officialDocuments.
 *             It says when the material was submitted, not when the photo
 *             was taken.
 *
 * Production fact (job eeefada9, 2026-10-11): every stored visual had
 * date/exifDate/caseRef null; the case join is the only date there is.
 */

import { fileNameDate, isRenderName } from './visualAssets.ts';

export type CaptureDateSource = 'EXIF' | 'PROVIDER_CAPTURE';
export type DocumentDateSource = 'CASE_FILED' | 'FILE_NAME';

export interface VisualCaptureDate { date: string; source: CaptureDateSource }
export interface VisualDocumentDate { date: string; source: DocumentDateSource; caseRef: string | null }
export interface VisualDates { capture: VisualCaptureDate | null; document: VisualDocumentDate | null }

/** A TAS document id's case: its reference and filing date. */
export interface VisualCaseRecord { caseRef: string | null; date: string | null }

const ISO = /^\d{4}-\d{2}-\d{2}/;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const validIso = (v: unknown): string | null => {
  const s = str(v);
  if (!ISO.test(s)) return null;
  const d = s.slice(0, 10);
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
};
const CASE_REF = /^[A-Z]{1,4}\d{3,14}$/;

/** documentId → { caseRef, date } from synthesis_json.officialDocuments (caseRef / caseDate). */
export function caseIndex(officialDocuments: unknown): Map<string, VisualCaseRecord> {
  const m = new Map<string, VisualCaseRecord>();
  for (const d of Array.isArray(officialDocuments) ? officialDocuments : []) {
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    const id = str(o.documentId);
    if (!/^\d{3,12}$/.test(id) || m.has(id)) continue;
    const ref = str(o.caseRef);
    m.set(id, { caseRef: CASE_REF.test(ref) ? ref : null, date: validIso(o.caseDate ?? o.date) });
  }
  return m;
}

/** The TAS document id a visual record was filed with (stored record or customer asset shape). */
export function visualDocumentId(v: Record<string, unknown>): string | null {
  const ref = v.documentRef && typeof v.documentRef === 'object' ? (v.documentRef as Record<string, unknown>).documentId : null;
  const id = str(ref) || str(v.documentId);
  return /^\d{3,12}$/.test(id) ? id : null;
}

const PHOTO_KINDS = new Set(['PHOTO', 'CONSTRUCTION_PHOTO']);

/**
 * A camera date belongs only to a photograph. A photomontage stored as PHOTO
 * is a render by its name (visualAssets.ts) and has no capture date.
 */
function isPhotograph(v: Record<string, unknown>): boolean {
  return PHOTO_KINDS.has(str(v.kind).toUpperCase()) && !isRenderName(v.fileName);
}

/**
 * The provenance dates of one official visual: its case (joined through
 * officialDocuments), its capture date (EXIF only) and its document date
 * (file-name date, else case filing date). `today` (YYYY-MM-DD), when given,
 * refuses any date after it.
 */
export function visualDates(
  visual: unknown,
  cases: Map<string, VisualCaseRecord> | unknown,
  opts: { today?: string | null } = {},
): { caseRef: string | null; dates: VisualDates } {
  const v = (visual && typeof visual === 'object' ? visual : {}) as Record<string, unknown>;
  const index = cases instanceof Map ? (cases as Map<string, VisualCaseRecord>) : caseIndex(cases);
  const today = validIso(opts.today);
  const notFuture = (d: string | null) => (d && (!today || d <= today) ? d : null);
  const docId = visualDocumentId(v);
  const kase = docId ? index.get(docId) : undefined;
  const ownRef = str(v.caseRef);
  const caseRef = kase?.caseRef ?? (CASE_REF.test(ownRef) ? ownRef : null);
  const caseDate = notFuture(validIso(kase?.date));

  // Capture: the camera's own EXIF date, on a photograph, and nothing else.
  // A stored dates.capture written by this module (EXIF) is honoured for
  // records whose exifDate field was not carried through.
  const storedCapture = v.dates && typeof v.dates === 'object' ? ((v.dates as Record<string, unknown>).capture as Record<string, unknown> | null) : null;
  const exif = notFuture(validIso(v.exifDate)) ?? (storedCapture && str(storedCapture.source) === 'EXIF' ? notFuture(validIso(storedCapture.date)) : null);
  const capture: VisualCaptureDate | null = exif && isPhotograph(v) ? { date: exif, source: 'EXIF' } : null;

  // Document: a date the official file name states, else the case filing date.
  const named = notFuture(fileNameDate(v.fileName, caseDate));
  let document: VisualDocumentDate | null = named
    ? { date: named, source: 'FILE_NAME', caseRef }
    : caseDate
      ? { date: caseDate, source: 'CASE_FILED', caseRef }
      : null;
  // A record stored with its dates already (built by this module) keeps them when the join is gone.
  if (!document && v.dates && typeof v.dates === 'object') {
    const sd = (v.dates as Record<string, unknown>).document as Record<string, unknown> | null;
    const d = sd ? notFuture(validIso(sd.date)) : null;
    const src = sd ? str(sd.source) : '';
    if (d && (src === 'CASE_FILED' || src === 'FILE_NAME')) {
      const r = str(sd!.caseRef);
      document = { date: d, source: src, caseRef: CASE_REF.test(r) ? r : caseRef };
    }
  }
  return { caseRef: caseRef ?? document?.caseRef ?? null, dates: { capture, document } };
}

/**
 * Build time (verify-synthesis): every persisted official visual gets its
 * `caseRef` and `dates`. Nothing else in the record changes; a non-object
 * entry passes through untouched.
 */
export function withVisualDates<T>(visuals: T[], officialDocuments: unknown, opts: { today?: string | null } = {}): T[] {
  if (!Array.isArray(visuals)) return visuals;
  const index = caseIndex(officialDocuments);
  return visuals.map((v) => {
    if (!v || typeof v !== 'object') return v;
    const { caseRef, dates } = visualDates(v, index, opts);
    return { ...(v as Record<string, unknown>), caseRef, dates } as T;
  });
}

/** A stored `dates` value, re-validated (read path): only the shapes above survive. */
export function sanitizeVisualDates(raw: unknown): VisualDates | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const c = o.capture && typeof o.capture === 'object' ? (o.capture as Record<string, unknown>) : null;
  const d = o.document && typeof o.document === 'object' ? (o.document as Record<string, unknown>) : null;
  const cDate = c ? validIso(c.date) : null;
  const cSrc = c ? str(c.source) : '';
  const dDate = d ? validIso(d.date) : null;
  const dSrc = d ? str(d.source) : '';
  const dRef = d ? str(d.caseRef) : '';
  const capture = cDate && (cSrc === 'EXIF' || cSrc === 'PROVIDER_CAPTURE') ? { date: cDate, source: cSrc as CaptureDateSource } : null;
  const document = dDate && (dSrc === 'CASE_FILED' || dSrc === 'FILE_NAME') ? { date: dDate, source: dSrc as DocumentDateSource, caseRef: CASE_REF.test(dRef) ? dRef : null } : null;
  return capture || document ? { capture, document } : null;
}

/* ───────────────────────── fresh photos (synthesis_json.freshPhotos) ───────────────────────── */

export type FreshPhotoSource = 'WIKIMEDIA_COMMONS' | 'MAPILLARY' | 'DEVELOPER_SITE' | 'OTHER';

/** One accepted fresh photo, validated for the gallery. */
export interface FreshPhotoView {
  id: string;
  url: string | null;
  source: FreshPhotoSource;
  sourceUrl: string | null;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** Only a provider/EXIF-stated capture date. */
  capture: VisualCaptureDate | null;
  /** Upload / publication date: shown as such, never as capture. */
  publishedAt: string | null;
  retrievedAt: string | null;
  scope: 'BUILDING' | 'DEVELOPMENT';
  width: number | null;
  height: number | null;
}

const FRESH_SOURCES = new Set<FreshPhotoSource>(['WIKIMEDIA_COMMONS', 'MAPILLARY', 'DEVELOPER_SITE', 'OTHER']);
const httpsUrl = (v: unknown): string | null => {
  const s = str(v);
  return /^https:\/\/[^\s]+$/i.test(s) && s.length <= 2048 ? s : null;
};
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * synthesis_json.freshPhotos ({ version, status, photos[] } or a bare array)
 * → the accepted photos, validated. A capture date counts only with its
 * source (EXIF / PROVIDER_CAPTURE); a future capture date is refused.
 */
export function freshPhotoViews(raw: unknown, opts: { today?: string | null } = {}): FreshPhotoView[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as Record<string, unknown>).photos : null;
  const today = validIso(opts.today);
  const out: FreshPhotoView[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const id = str(o.id).slice(0, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const src = str(o.source).toUpperCase() as FreshPhotoSource;
    const capSrc = str(o.captureDateSource);
    const cap = validIso(o.capturedAt);
    const capture = cap && (capSrc === 'EXIF' || capSrc === 'PROVIDER_CAPTURE') && (!today || cap <= today) ? { date: cap, source: capSrc as CaptureDateSource } : null;
    out.push({
      id,
      url: str(o.url) || null,
      source: FRESH_SOURCES.has(src) ? src : 'OTHER',
      sourceUrl: httpsUrl(o.sourceUrl),
      author: str(o.author).slice(0, 160) || null,
      license: str(o.license).slice(0, 80) || null,
      licenseUrl: httpsUrl(o.licenseUrl),
      capture,
      publishedAt: validIso(o.publishedAt),
      retrievedAt: validIso(o.retrievedAt),
      scope: str(o.scope) === 'DEVELOPMENT' ? 'DEVELOPMENT' : 'BUILDING',
      width: posInt(o.width),
      height: posInt(o.height),
    });
  }
  return out;
}

/* ───────────────────────── the document date, as a sentence needs it ───────────────────────── */

/** Georgian instrumental month: "2025 წლის 14 აპრილით" (dated BY). Never "აპრილის ფოტო". */
const KA_INSTR = ['იანვრით', 'თებერვლით', 'მარტით', 'აპრილით', 'მაისით', 'ივნისით', 'ივლისით', 'აგვისტოთი', 'სექტემბრით', 'ოქტომბრით', 'ნოემბრით', 'დეკემბრით'];

export function kaDatedBy(iso: string | null | undefined): string | null {
  const d = validIso(iso);
  if (!d) return null;
  return `${d.slice(0, 4)} წლის ${Number(d.slice(8, 10))} ${KA_INSTR[Number(d.slice(5, 7)) - 1]}`;
}

const LOCALE: Record<string, string> = { en: 'en-GB', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar', he: 'he-IL' };

/**
 * The {{date}} of "materials dated {{date}}": KA in the instrumental case
 * ("2025 წლის 14 აპრილით"), every other language a long date in its own
 * locale, falling back to DD.MM.YYYY.
 */
export function documentDatePhrase(iso: string | null | undefined, lang: string): string | null {
  const d = validIso(iso);
  if (!d) return null;
  if (lang === 'ka') return kaDatedBy(d);
  try {
    return new Intl.DateTimeFormat(LOCALE[lang] ?? 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  } catch {
    return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
  }
}
