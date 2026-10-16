/*
 * THE OFFICIAL DOCUMENT LIBRARY — what a buyer can actually open, grouped by
 * what each file proves.
 *
 * Pure and dependency-free: the report UI (OfficialDocuments.tsx) and the
 * secure viewer's server gate (research-agent `document_file`) read the SAME
 * rules, so a button the page shows is a file the server will serve, and a
 * file the server refuses never appears as a button.
 *
 * WHY NOT THE OFFICIAL LINK.
 * docs.tbilisi.gov.ge's DownloadServlet answers many customer browsers with
 * "Access Denied" while the worker downloads the same file fine. A raw
 * DownloadServlet link is therefore never a usable button: viewable files
 * (pdf / jpg / png) open through HOMATCH's secure viewer (fetched once by the
 * worker, cached privately, signed for minutes); technical formats (dwg, pla,
 * rar …) are listed in the full library only, as not viewable in a browser.
 *
 * Grouping is deterministic, by the file's kind and name (Georgian and the
 * Latin transliterations TAS applicants actually use): permits/decisions and
 * register extracts first, then the approved project drawings, expert
 * conclusions, site photos, everything else.
 */

export type DocGroupKey = 'PERMITS' | 'DRAWINGS' | 'EXPERT' | 'PHOTOS' | 'OTHER';
export const DOC_GROUP_ORDER: DocGroupKey[] = ['PERMITS', 'DRAWINGS', 'EXPERT', 'PHOTOS', 'OTHER'];

/** VIEWABLE: openable in the secure viewer. TECHNICAL: a CAD/archive format no browser opens. PRIVATE: personal papers (power of attorney, ID) never served. NO_ID: no attachment reference. */
export type DocAccess = 'VIEWABLE' | 'TECHNICAL' | 'PRIVATE' | 'NO_ID';

export const VIEWABLE_FORMATS = new Set(['pdf', 'jpg', 'jpeg', 'png']);
const TECHNICAL_FORMATS = /^(dwg|dxf|dwf|pla|pln|rvt|ifc|skp|rar|zip|7z|tar|gz|doc|docx|xls|xlsx|tif|tiff|heic)$/;

/* Personal papers: a power of attorney or an identity document carries a private person's id number. */
const PRIVATE_NAME = /მინდობილობ|პირადობ|პასპორტ|mindobilob|piradob|passport|\bid[\s_-]?card\b/iu;
const EXPERT_NAME = /ექსპერტიზ|საექსპერტო|დასკვნ|გეოლოგ|გეოტექნ|ტაქსაცი|აუდიტ|expert|eqspert|ekspert|geolog|geotech|daskvn|conclusion|taqsac/iu;
const PERMIT_NAME = /ნებართვ|გადაწყვეტილებ|განკარგულებ|ბრძანებ|დადგენილებ|შეთანხმებ|ამონაწერ|პასუხ|ოქმ|nebartv|gadawyvet|gadatsyvet|brdzaneb|amonawer|permit|decision|resolution|response|extract/iu;
const PHOTO_NAME = /ფოტო|სურათ|ბანერ|მონტაჟ|photo|foto|baner|banner|montaj|montage|\bimg[_-]|\bdsc/iu;
const DRAWING_NAME = /გეგმ|ნახაზ|ჭრილ|ფასად|ესკიზ|პროექტ|სქემ|რენდერ|ტოპო|კონსტრუქც|gegm|chril|fasad|eskiz|proeqt|proekt|sqem|plan|section|elevation|facade|site|topo|render|\bpos\b|konstruq|konstruk/iu;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The TAS attachment id: the stored field, or the id inside a DownloadServlet URL on docs.tbilisi.gov.ge. */
export function attachedFileIdOf(file: unknown): string | null {
  const f = obj(file);
  const direct = s(f.attachedFileId);
  if (/^\d{1,12}$/.test(direct)) return direct;
  const url = s(f.sourceUrl);
  const m = /^https:\/\/docs\.tbilisi\.gov\.ge\/DownloadServlet\?(?:[^#]*&)?attachedFileId=(\d{1,12})(?:&|$)/.exec(url);
  return m ? m[1] : null;
}

export function fileFormatOf(file: unknown): string | null {
  const f = obj(file);
  const raw = s(f.format).replace(/^\./, '').toLowerCase() || (/\.([a-z0-9]{2,5})$/i.exec(s(f.fileName))?.[1]?.toLowerCase() ?? '');
  return raw ? raw.slice(0, 8) : null;
}

export function fileAccessOf(file: unknown): DocAccess {
  const f = obj(file);
  if (PRIVATE_NAME.test(s(f.fileName))) return 'PRIVATE';
  const fmt = fileFormatOf(f);
  if (fmt && TECHNICAL_FORMATS.test(fmt)) return 'TECHNICAL';
  if (!fmt || !VIEWABLE_FORMATS.has(fmt)) return 'TECHNICAL';
  return attachedFileIdOf(f) ? 'VIEWABLE' : 'NO_ID';
}

/** Which group a file belongs to — by name first (the applicant's own label), then by kind. */
export function documentGroupOf(file: unknown): DocGroupKey {
  const f = obj(file);
  const name = s(f.fileName);
  const kind = s(f.kind).toUpperCase();
  if (EXPERT_NAME.test(name)) return 'EXPERT';
  if (PERMIT_NAME.test(name)) return 'PERMITS';
  if (PHOTO_NAME.test(name)) return 'PHOTOS';
  if (DRAWING_NAME.test(name) || kind === 'DRAWING') return 'DRAWINGS';
  if (kind === 'IMAGE') return 'PHOTOS';
  return 'OTHER';
}

export interface LibraryItem {
  attachedFileId: string | null;
  fileName: string;
  format: string | null;
  group: DocGroupKey;
  access: DocAccess;
  /** The worker could not retrieve it during research: never in the main view. */
  failed: boolean;
  outcome: string | null;
  pages: number | null;
  caseRef: string | null;
  caseDate: string | null;
  priority: 1 | 2 | null;
}

export interface LibraryGroup {
  key: DocGroupKey;
  /** The most useful viewable files, newest/priority first, one per file name. */
  top: LibraryItem[];
  /** Viewable files in this group beyond `top`. */
  more: number;
}

export interface DocumentLibrary {
  groups: LibraryGroup[];
  /** Every file, every case, for the collapsed full library. */
  all: LibraryItem[];
  counts: { total: number; viewable: number; technical: number; private: number; failed: number };
}

const day = (v: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const READ_RANK = (o: string | null): number => (o === 'READ_TEXT' ? 0 : o === 'IMAGE' || o === 'LOW_TEXT' ? 1 : o === 'SCAN_OR_IMAGE_ONLY' ? 2 : 3);

/** Every file of the stored officialDocuments ledger, flattened with its case. */
export function libraryItems(docs: unknown): LibraryItem[] {
  const out: LibraryItem[] = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    const c = obj(d);
    const priority = c.priority === 1 || c.priority === 2 ? c.priority : null;
    for (const f of Array.isArray(c.files) ? c.files : []) {
      const file = obj(f);
      if (!s(file.fileName) && !attachedFileIdOf(file)) continue;
      const outcome = s(file.outcome).toUpperCase() || null;
      out.push({
        attachedFileId: attachedFileIdOf(file),
        fileName: s(file.fileName).slice(0, 160) || 'ფაილი',
        format: fileFormatOf(file),
        group: documentGroupOf(file),
        access: fileAccessOf(file),
        failed: outcome === 'DOWNLOAD_FAILED',
        outcome,
        pages: typeof file.pages === 'number' && Number.isInteger(file.pages) && file.pages > 0 ? file.pages : null,
        caseRef: s(c.caseRef) || null,
        caseDate: day(c.caseDate) ?? day(file.date),
        priority,
      });
    }
  }
  return out;
}

/** Most useful first: priority cases, then the newest case, then what was actually read. */
export function byUsefulness(a: LibraryItem, b: LibraryItem): number {
  return ((a.priority ?? 9) - (b.priority ?? 9))
    || (b.caseDate ?? '').localeCompare(a.caseDate ?? '')
    || READ_RANK(a.outcome) - READ_RANK(b.outcome)
    || a.fileName.localeCompare(b.fileName);
}

const nameKey = (n: string) => n.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\s_.,()-]+/g, ' ').trim();

export function buildDocumentLibrary(docs: unknown, opts: { perGroup?: number } = {}): DocumentLibrary {
  const perGroup = opts.perGroup ?? 3;
  const all = libraryItems(docs).sort(byUsefulness);
  const groups: LibraryGroup[] = [];
  for (const key of DOC_GROUP_ORDER) {
    const openable = all.filter((i) => i.group === key && i.access === 'VIEWABLE' && !i.failed);
    if (!openable.length) continue;
    const seen = new Set<string>();
    const unique = openable.filter((i) => {
      const k = nameKey(i.fileName);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    groups.push({ key, top: unique.slice(0, perGroup), more: openable.length - Math.min(perGroup, unique.length) });
  }
  return {
    groups,
    all,
    counts: {
      total: all.length,
      viewable: all.filter((i) => i.access === 'VIEWABLE').length,
      technical: all.filter((i) => i.access === 'TECHNICAL').length,
      private: all.filter((i) => i.access === 'PRIVATE').length,
      failed: all.filter((i) => i.failed).length,
    },
  };
}

/**
 * THE SERVER GATE (research-agent `document_file`): the file must exist in
 * THIS job's ledger and be viewable. Anything else is refused with a reason.
 */
export function ledgerFileFor(docs: unknown, attachedFileId: unknown):
  | { ok: true; item: LibraryItem; format: 'pdf' | 'jpg' | 'png' }
  | { ok: false; reason: 'bad_id' | 'not_in_report' | 'not_viewable' | 'private_document' } {
  const id = s(attachedFileId);
  if (!/^\d{1,12}$/.test(id)) return { ok: false, reason: 'bad_id' };
  const item = libraryItems(docs).find((i) => i.attachedFileId === id);
  if (!item) return { ok: false, reason: 'not_in_report' };
  if (item.access === 'PRIVATE') return { ok: false, reason: 'private_document' };
  if (item.access !== 'VIEWABLE') return { ok: false, reason: 'not_viewable' };
  const format = item.format === 'png' ? 'png' : item.format === 'jpg' || item.format === 'jpeg' ? 'jpg' : 'pdf';
  return { ok: true, item, format };
}

/** Private cache path for one attachment (DOCUMENT_BUCKET). */
export const documentCachePath = (attachedFileId: string, format: 'pdf' | 'jpg' | 'png'): string => `files/${attachedFileId}.${format}`;
export const DOCUMENT_URL_TTL_SECONDS = 600;
/** Private bucket (migration 20261030091500): pdf/jpeg/png only, service role only. */
export const DOCUMENT_BUCKET = 'verify-documents';
