// priority.ts — the "two newest cases" FULL-FIDELITY rule (pure helpers).
//
// The newest two TAS applications filed for the searched parcel decide what
// a buyer must know about the property's CURRENT official situation, so they
// are read completely — every attachment, every page, full text — before any
// budget is spent on older history. Older cases keep the relevance budget.
//
// "Newest" is the application's own registration/submission date (the case
// `date` from the detail/search record) — never attachment upload time,
// never list order. Ties break deterministically: date desc, then
// registration number desc (numeric-aware), then documentId desc.

import { parseTasDateMs } from './tasModel.js';
import { parcelMatches } from './visuals.js';

export type PriorityRank = 1 | 2;

export interface PriorityInput {
  documentId: string;
  registrationNumber: string | null;
  /** Raw or ISO date of the application (detail.submittedAt ?? searchRow.date). */
  date: unknown;
  /** The case's own cadastral codes (detail graph + search row). */
  cadastralCodes: string[];
}

export interface PriorityPick {
  documentId: string;
  priority: PriorityRank;
  dateMs: number | null;
  /** true = codes name the parcel; null = the case carries no codes (it was returned FOR the parcel search). */
  parcelMatch: boolean | null;
}

/** Numeric-aware descending comparison of registration numbers (AR11161121 > AR1965637). */
export function compareRegistrationDesc(a: string | null, b: string | null): number {
  const da = (a ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const db = (b ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (da.length !== db.length) return db.length - da.length;
  if (da !== db) return db < da ? -1 : 1;
  return (b ?? '').localeCompare(a ?? '');
}

const idDesc = (a: string, b: string) => (a.length !== b.length ? b.length - a.length : b < a ? -1 : b > a ? 1 : 0);

/** Deterministic newest-first order (dated cases first; undated last). */
export function compareNewestFirst(a: { dateMs: number | null; registrationNumber: string | null; documentId: string }, b: typeof a): number {
  if (a.dateMs !== b.dateMs) {
    if (a.dateMs === null) return 1;
    if (b.dateMs === null) return -1;
    return b.dateMs - a.dateMs;
  }
  return compareRegistrationDesc(a.registrationNumber, b.registrationNumber) || idDesc(a.documentId, b.documentId);
}

/**
 * The two newest cases that belong to the searched parcel. A case whose own
 * cadastral codes name a DIFFERENT parcel never qualifies; a case with no
 * codes qualifies because TAS returned it for the parcel search itself.
 */
export function selectPriorityCases(cases: PriorityInput[], parcel: string | null, n = 2): PriorityPick[] {
  const seen = new Set<string>();
  const ranked = cases
    .filter((c) => (seen.has(c.documentId) ? false : (seen.add(c.documentId), true)))
    .map((c) => ({ ...c, dateMs: parseTasDateMs(c.date), parcelMatch: parcelMatches(c.cadastralCodes.filter(Boolean), parcel) }))
    .filter((c) => c.parcelMatch !== false)
    .sort(compareNewestFirst);
  return ranked.slice(0, n).map((c, i) => ({ documentId: c.documentId, priority: (i + 1) as PriorityRank, dateMs: c.dateMs, parcelMatch: c.parcelMatch }));
}

/** Formats nothing in this worker can read: accounted from metadata, never downloaded "to interpret". */
export const UNSUPPORTED_EXTENSIONS = new Set(['dwg', 'dxf', 'pla', 'pln', 'rvt', 'ifc', 'skp', 'max', '3ds', 'rar', 'zip', '7z', 'tar', 'gz']);
export function isUnsupportedExtension(ext: string | null | undefined): boolean {
  return !!ext && UNSUPPORTED_EXTENSIONS.has(ext.toLowerCase());
}

/** Older-case text that must survive the relevance budget: decisions, conflicts, registered rights. */
export const MATERIAL_TEXT = /(დავა|სასამართლ|გასაჩივრ|საჩივარ|უფლებ|იპოთეკ|ყადაღ|აკრძალვ|მესაკუთრ|შეჩერებ|გაუქმებ|უარი|dispute|court|appeal|complaint|mortgage|seizure|lien|encumbr|ownership|suspend|cancel|refus|спор|суд|ипотек|арест|обремен)/i;

export interface PriorityCompleteness {
  fieldsDiscovered: number;
  fieldsPersisted: number;
  attachmentsDiscovered: number;
  attachmentsRead: number;
  attachmentsDeferred: number;
  attachmentsUnsupported: number;
  imagesProcessed: number;
  pagesRendered: number;
  textComplete: boolean;
  /** Why the case is NOT complete. Empty ⇔ complete. */
  reasons: string[];
  /** Facts about coverage that are not losses (e.g. scanned pages without a text layer). */
  notes: string[];
  /** Attachments a follow-up run continues with (deterministic order). */
  deferredAttachmentIds: string[];
}

export interface CompletenessInput {
  detailRead: boolean;
  fieldsDiscovered: number;
  fieldsPersisted: number;
  attachments: Array<{ attachedFileId: string; outcome: string; imagesProcessed?: number; pagesRendered?: number; scanPagesUnrendered?: number; scanPages?: number[]; renderFailed?: boolean }>;
  motions: Array<{ response: string }>;
  formStatus: 'CAPTURED' | 'NOT_AVAILABLE' | 'FAILED' | 'DISABLED' | null;
  textInlineComplete: boolean;
  renderAvailable: boolean;
}

const READ_OUTCOMES = new Set(['READ_TEXT', 'LOW_TEXT', 'SCAN_OR_IMAGE_ONLY', 'IMAGE', 'EMPTY']);

/** The per-priority-case completeness gate. Never COMPLETE with anything deferred or failed. */
export function buildCompleteness(i: CompletenessInput): PriorityCompleteness {
  const reasons: string[] = [];
  const notes: string[] = [];
  const atts = [...i.attachments].sort((a, b) => idDesc(b.attachedFileId, a.attachedFileId));
  const deferred = atts.filter((a) => a.outcome === 'DEFERRED' || a.outcome === 'NOT_PROCESSED_BUDGET');
  const failed = atts.filter((a) => a.outcome === 'DOWNLOAD_FAILED' || a.outcome === 'FAILED');
  const unsupported = atts.filter((a) => a.outcome === 'UNSUPPORTED_FORMAT');
  const unfetched = i.motions.filter((m) => m.response === 'NOT_FETCHED' || m.response === 'FAILED').length;
  const scanUnrendered = atts.reduce((n, a) => n + (a.scanPagesUnrendered ?? 0), 0);
  const scanPages = atts.reduce((n, a) => n + (a.scanPages?.length ?? 0), 0);
  const renderFailed = atts.filter((a) => a.renderFailed).length;
  if (!i.detailRead) reasons.push('DETAIL_NOT_READ');
  if (unfetched) reasons.push(`MOTION_RESPONSES_NOT_READ:${unfetched}`);
  if (deferred.length) reasons.push(`ATTACHMENTS_DEFERRED:${deferred.length}`);
  if (failed.length) reasons.push(`ATTACHMENTS_FAILED:${failed.length}`);
  if (scanUnrendered) reasons.push(i.renderAvailable ? `SCAN_PAGES_NOT_RENDERED:${scanUnrendered}` : `SCAN_PAGES_NOT_RENDERED_NO_RENDERER:${scanUnrendered}`);
  if (renderFailed) reasons.push(`PAGE_RENDER_FAILED:${renderFailed}`);
  if (i.formStatus === 'FAILED') reasons.push('FORM_CAPTURE_FAILED');
  if (!i.textInlineComplete) reasons.push('TEXT_INCOMPLETE');
  if (unsupported.length) notes.push(`UNSUPPORTED_FORMATS_ACCOUNTED:${unsupported.length}`);
  if (scanPages) notes.push(`SCANNED_PAGES_WITHOUT_TEXT_LAYER:${scanPages}`);
  if (i.formStatus === 'NOT_AVAILABLE') notes.push('FORM_NOT_AVAILABLE');
  if (i.formStatus === 'DISABLED') notes.push('FORM_DISCOVERY_DISABLED');
  const textComplete = i.detailRead && unfetched === 0 && deferred.length === 0 && failed.length === 0 && i.textInlineComplete;
  return {
    fieldsDiscovered: i.fieldsDiscovered,
    fieldsPersisted: i.fieldsPersisted,
    attachmentsDiscovered: atts.length,
    attachmentsRead: atts.filter((a) => READ_OUTCOMES.has(a.outcome)).length,
    attachmentsDeferred: deferred.length,
    attachmentsUnsupported: unsupported.length,
    imagesProcessed: atts.reduce((n, a) => n + (a.imagesProcessed ?? 0), 0),
    pagesRendered: atts.reduce((n, a) => n + (a.pagesRendered ?? 0), 0),
    textComplete,
    reasons,
    notes,
    deferredAttachmentIds: deferred.map((a) => a.attachedFileId),
  };
}

// ───────────────────────── DWR interface discovery (pure) ─────────────────────────

export interface DwrMethodInfo {
  script: string;
  method: string;
  /** Declared parameters, callback excluded. */
  arity: number;
}

/** WHATWG URL parts (the local type shim declares only a subset). */
export const parseUrl = (u: string, base?: string): { origin: string; pathname: string; toString(): string } => new (URL as any)(u, base);

/** `<script src=".../dwr/interface/X.js">` references on the public page, same origin only. */
export function findInterfaceScripts(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  const origin = parseUrl(pageUrl).origin;
  while ((m = re.exec(html))) {
    try {
      const u = parseUrl(m[1], pageUrl);
      if (u.origin !== origin) continue;
      if (!/^\/architect\/dwr\/interface\/[A-Za-z0-9_]+\.js$/.test(u.pathname)) continue;
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch { /* malformed src */ }
  }
  return out;
}

/** Methods a DWR 2/3 interface script exposes (both generated styles). */
export function parseDwrInterface(js: string, scriptHint?: string): DwrMethodInfo[] {
  const out = new Map<string, DwrMethodInfo>();
  // DWR 3: p.method = function(p0, p1, callback) { return dwr.engine._execute(p._path, 'Script', 'method', arguments); }
  // DWR 2: Script.method = function(p0, callback) { dwr.engine._execute(Script._path, 'Script', 'method', p0, callback); }
  const re = /([A-Za-z0-9_$]+)\.([A-Za-z0-9_]+)\s*=\s*function\s*\(([^)]*)\)\s*\{[^}]*?_execute\(\s*[^,]+,\s*['"]([A-Za-z0-9_]+)['"]\s*,\s*['"]([A-Za-z0-9_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js))) {
    const params = m[3].split(',').map((p) => p.trim()).filter(Boolean).filter((p) => !/^callback$/i.test(p));
    const info = { script: m[4], method: m[5], arity: params.length };
    out.set(`${info.script}.${info.method}`, info);
  }
  if (!out.size && scriptHint) {
    const re2 = new RegExp(`${scriptHint}\\.([A-Za-z0-9_]+)\\s*=\\s*function\\s*\\(([^)]*)\\)`, 'g');
    while ((m = re2.exec(js))) {
      const params = m[2].split(',').map((p) => p.trim()).filter(Boolean).filter((p) => !/^callback$/i.test(p));
      out.set(`${scriptHint}.${m[1]}`, { script: scriptHint, method: m[1], arity: params.length });
    }
  }
  return [...out.values()];
}

/** Write-ish verbs: never called, whatever the rest of the name says. */
const WRITE_VERB = /(save|update|delete|remove|set[A-Z]|add|insert|create|send|submit|upload|sign|pay|register|change|edit|approve|reject|cancel|logout|login|auth|reset|mark|move|copy|generate|start|stop)/i;
const READ_FORM = /^(get|load|read|find|fetch|view|show)[A-Za-z0-9_]*(public|form|value|application|document|doc)/i;

/**
 * The single method worth one read-only call: its name clearly reads a
 * document / form / values by id (one parameter). Preference: public >
 * form > values > document. The detail method already used is excluded.
 */
export function pickFormMethod(methods: DwrMethodInfo[], exclude: string[] = ['UserMethods.getUserDocumentLastMotion', 'DocumentManager.getDocsForPublicInfo']): DwrMethodInfo | null {
  const score = (m: DwrMethodInfo): number => {
    const n = m.method;
    if (exclude.includes(`${m.script}.${m.method}`)) return -1;
    // An operator interface, or field metadata rather than a case's values.
    if (/^Administration$/i.test(m.script)) return -1;
    if (/(MimeTypes?|Types$|Config|Settings|Meta|Schema|Defs?$|Definitions?)/.test(n)) return -1;
    if (m.arity !== 1) return -1;
    if (!/^(get|load|read|find|fetch|view|show)/i.test(n)) return -1;
    if (WRITE_VERB.test(n.replace(/^(get|load|read|find|fetch|view|show)/i, ''))) return -1;
    if (!READ_FORM.test(n)) return -1;
    if (/(List|Search|All[A-Z]|All$|Count|Motion|Docs(?![a-z]))/.test(n)) return -1; // not a single document's form
    return /public/i.test(n) ? 4 : /form/i.test(n) ? 3 : /values?/i.test(n) ? 2 : 1;
  };
  const ranked = methods.map((m) => ({ m, s: score(m) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || `${a.m.script}.${a.m.method}`.localeCompare(`${b.m.script}.${b.m.method}`));
  return ranked[0]?.m ?? null;
}
