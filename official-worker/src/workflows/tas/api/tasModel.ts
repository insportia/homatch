// tasModel.ts — pure normalisation of TAS public DWR object graphs into the
// worker's structured case model, plus truthful payload classification.
//
// Field names in TAS's graph are the Java bean properties of its public
// application. The ones the product depends on (docAuthor, coApplicants,
// docValues, docClassCalculatorValues, archDocMeta, archDocType,
// attachedFiles, motionId, attachedFileId) are read by name; everything else
// meaningful is PRESERVED in `unmapped` rather than silently discarded, so an
// unknown field is an audit finding, never a loss.
//
// Collection is graph-wide: an attachment is "any object carrying an
// attachedFileId" wherever it sits (case level, inside a motion, inside a
// response), deduplicated by that id. That is what makes the case-level
// attachments with motionId = null countable — see dwr.ts's header.

import { walkObjects, toPlain, type DwrValue } from './dwr.js';

/** The repository's local Buffer type shim exposes only the string overload. */
export const bytesToBuffer = Buffer.from as unknown as (bytes: Uint8Array) => Buffer;

// ───────────────────────────── search results ─────────────────────────────

export interface TasSearchRow {
  documentId: string;
  registrationNumber: string | null;
  title: string | null;
  status: string | null;
  statusId: number | null;
  date: string | null;
  address: string | null;
  cadastralCode: string | null;
  raw: Record<string, unknown>;
}

export interface TasSearchPage {
  rows: TasSearchRow[];
  /** The server's own total, when it states one. */
  total: number | null;
}

const DOC_ID_KEYS = ['documentId', 'docId', 'id', 'docID'];
const TOTAL_KEYS = ['totalCount', 'total', 'totalSize', 'count', 'totalRecords', 'size'];

function firstKey(o: Record<string, any>, keys: string[]): any {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
}

export function scalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string') {
    const t = v.replace(/\s+/g, ' ').trim();
    return t ? t : null;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** A date value in a DWR reply: a Date, epoch millis, ISO, or DD/MM/YYYY|DD.MM.YYYY. */
export function toIsoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number' && v > 315532800000 && v < 4102444800000) return new Date(v).toISOString();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0));
    return Number.isNaN(d.getTime()) || +m[2] > 12 ? null : d.toISOString();
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** The array of result rows inside a search reply, wherever the server put it. */
function rowsOf(data: DwrValue): { rows: Record<string, any>[]; total: number | null } {
  if (Array.isArray(data)) return { rows: data.filter((r) => r && typeof r === 'object') as any[], total: null };
  if (data && typeof data === 'object' && !(data instanceof Date)) {
    const o = data as Record<string, any>;
    // The public page reads the total from sources[0] in some processing.
    const fromSources = Array.isArray(o.sources) && (typeof o.sources[0] === 'number' || /^\d+$/.test(String(o.sources[0] ?? ''))) ? Number(o.sources[0]) : undefined;
    const totalRaw = firstKey(o, TOTAL_KEYS) ?? fromSources;
    const total = totalRaw === undefined || totalRaw === null ? null : typeof totalRaw === 'number' ? totalRaw : Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : null;
    // Live-verified: `{isSuccess:true, source:[...], sources:[total, ...]}`.
    // `source` is checked first; the generic names cover older replies.
    for (const k of ['source', 'data', 'rows', 'list', 'result', 'results', 'items', 'records', 'docs', 'documents']) {
      if (Array.isArray(o[k])) return { rows: o[k].filter((r: any) => r && typeof r === 'object'), total };
    }
    // Fall back to the first array of objects carrying a document id.
    for (const v of Object.values(o)) {
      if (Array.isArray(v) && v.some((r: any) => r && typeof r === 'object' && firstKey(r, DOC_ID_KEYS) !== undefined)) {
        return { rows: v as any[], total };
      }
    }
    return { rows: [], total };
  }
  return { rows: [], total: null };
}

export function parseSearchPage(data: DwrValue): TasSearchPage {
  const { rows, total } = rowsOf(data);
  const out: TasSearchRow[] = [];
  for (const r of rows) {
    const id = firstKey(r, DOC_ID_KEYS);
    if (id === undefined) continue;
    const documentId = String(id).trim();
    if (!/^\d+$/.test(documentId)) continue;
    out.push({
      documentId,
      registrationNumber: scalar(firstKey(r, ['documentNo', 'regNumber', 'registrationNumber', 'docNumber', 'arNumber', 'number', 'docNum'])),
      title: scalar(firstKey(r, ['docName', 'title', 'name', 'docTypeName', 'subject', 'description'])),
      status: scalar(firstKey(r, ['docStatusName', 'statusName', 'status'])),
      statusId: typeof r.docStatusId === 'number' ? r.docStatusId : typeof r.statusId === 'number' ? r.statusId : null,
      date: toIsoDate(firstKey(r, ['regDate', 'registrationDate', 'createDate', 'docDate', 'date', 'createdDate'])),
      address: scalar(firstKey(r, ['address', 'objectAddress', 'docAddress'])),
      cadastralCode: scalar(firstKey(r, ['naprCadCode', 'cadCode', 'cadastralCode'])),
      raw: toPlain(r as DwrValue) as Record<string, unknown>,
    });
  }
  return { rows: out, total };
}

export interface SearchReconciliation {
  pagesRequested: number;
  rowsSeen: number;
  uniqueDocumentIds: number;
  duplicateRows: number;
  sourceTotal: number | null;
  /** sourceTotal === uniqueDocumentIds, or null when the server stated none. */
  reconciled: boolean | null;
  stopReason: 'TOTAL_REACHED' | 'EMPTY_PAGE' | 'SHORT_PAGE' | 'REPEATED_PAGE' | 'MAX_PAGES' | 'DEADLINE';
}

/** Merge pages into unique documents, preserving first-seen order. */
export function mergeSearchPages(pages: TasSearchPage[]): { rows: TasSearchRow[]; duplicates: number } {
  const seen = new Map<string, TasSearchRow>();
  let duplicates = 0;
  for (const p of pages)
    for (const r of p.rows) {
      if (seen.has(r.documentId)) {
        duplicates++;
        continue;
      }
      seen.set(r.documentId, r);
    }
  return { rows: [...seen.values()], duplicates };
}

// ───────────────────────────── document detail ─────────────────────────────

export type PartyKind = 'PERSON' | 'ORGANIZATION' | 'UNKNOWN';

export interface TasParty {
  role: string;
  name: string;
  kind: PartyKind;
  /** Organisation identification code (9 digits) only. A private person's
   * personal number is never retained — see maskPersonalId(). */
  organizationId: string | null;
  personalIdMasked: string | null;
  sourcePath: string;
}

export interface TasAttachment {
  attachedFileId: string;
  fileName: string | null;
  extension: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  /** null = a case-level attachment not tied to a motion. */
  motionId: string | null;
  /** The storage-side id TAS exposes beside attachedFileId (provenance only). */
  fileIdOnStorage: string | null;
  date: string | null;
  description: string | null;
  sourcePath: string;
}

export interface TasMotion {
  motionId: string;
  date: string | null;
  name: string | null;
  status: string | null;
  decisionNumber: string | null;
  sourcePath: string;
}

export interface TasValue {
  key: string;
  label: string | null;
  value: string;
  group: 'docValues' | 'docClassCalculatorValues' | 'archDocMeta' | 'other';
}

export interface TasCaseDetail {
  documentId: string;
  docType: string | null;
  title: string | null;
  registrationNumber: string | null;
  status: string | null;
  submittedAt: string | null;
  lastMotionAt: string | null;
  address: string | null;
  cadastralCodes: string[];
  description: string | null;
  /** responseText the detail reply carries directly (live-observed field). */
  responseText: string | null;
  parties: TasParty[];
  values: TasValue[];
  attachments: TasAttachment[];
  motions: TasMotion[];
  /** Scalar fields of the root object that no mapping above consumed. */
  unmapped: Record<string, string>;
  objectCount: number;
}

const NAME_KEYS = ['fullName', 'name', 'legalName', 'orgName', 'companyName', 'organizationName', 'clientName', 'personName'];
const ORG_ID_KEYS = ['identificationCode', 'idCode', 'orgCode', 'companyCode', 'taxCode', 'taxId', 'identCode'];
const PERSONAL_ID_KEYS = ['personalNumber', 'personalNo', 'personalId', 'privateNumber', 'pid'];

export function maskPersonalId(id: string | null): string | null {
  if (!id) return null;
  const d = id.replace(/\D/g, '');
  if (d.length < 4) return null;
  return `•••${d.slice(-3)}`;
}

function partyName(o: Record<string, any>): string | null {
  const direct = scalar(firstKey(o, NAME_KEYS));
  if (direct) return direct;
  const first = scalar(o.firstName ?? o.firstname ?? o.fname);
  const last = scalar(o.lastName ?? o.lastname ?? o.surname ?? o.lname);
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined || null;
}

function partyFrom(o: Record<string, any>, role: string, path: string): TasParty | null {
  const name = partyName(o);
  if (!name) return null;
  const orgIdRaw = scalar(firstKey(o, ORG_ID_KEYS));
  const persIdRaw = scalar(firstKey(o, PERSONAL_ID_KEYS));
  const orgDigits = orgIdRaw ? orgIdRaw.replace(/\D/g, '') : '';
  const isOrgId = orgDigits.length === 9;
  const isPersonalByLen = orgDigits.length === 11;
  const legalForm = /(შპს|სს|ი\/მ|ააიპ|LLC|JSC|Ltd|ООО|ОАО|ЗАО|კოოპერატივ|ამხანაგობ)/i.test(name);
  const kind: PartyKind =
    isOrgId || legalForm || o.legalForm || o.isLegalEntity === true || o.isLegal === true
      ? 'ORGANIZATION'
      : isPersonalByLen || persIdRaw || o.firstName || o.lastName
        ? 'PERSON'
        : 'UNKNOWN';
  return {
    role,
    name,
    kind,
    organizationId: kind === 'ORGANIZATION' && isOrgId ? orgDigits : null,
    personalIdMasked: kind === 'PERSON' ? maskPersonalId(persIdRaw ?? (isPersonalByLen ? orgDigits : null)) : null,
    sourcePath: path,
  };
}

function roleFromKey(key: string, o: Record<string, any>): string {
  const explicit = scalar(o.roleName ?? o.role ?? o.typeName ?? o.applicantType ?? o.clientType);
  if (explicit) return explicit;
  const k = key.toLowerCase();
  if (k.includes('author')) return 'APPLICANT';
  if (k.includes('coapplicant')) return 'CO_APPLICANT';
  if (k.includes('architect')) return 'ARCHITECT';
  if (k.includes('developer')) return 'DEVELOPER';
  if (k.includes('client')) return 'CLIENT';
  if (k.includes('owner')) return 'OWNER';
  return 'PARTICIPANT';
}

function extOf(name: string | null): string | null {
  if (!name) return null;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}

function valueLabel(o: Record<string, any>): string | null {
  return scalar(o.name ?? o.label ?? o.title ?? o.fieldName ?? o.paramName ?? o.valueName ?? o.typeName ?? o.key);
}
function valueValue(o: Record<string, any>): string | null {
  const v = o.value ?? o.val ?? o.textValue ?? o.stringValue ?? o.numberValue ?? o.numValue ?? o.doubleValue ?? o.dateValue ?? o.valueText;
  return v instanceof Date ? v.toISOString() : scalar(v);
}

function collectValues(arr: unknown, group: TasValue['group'], out: TasValue[]): void {
  if (Array.isArray(arr)) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const label = valueLabel(item as any);
      const value = valueValue(item as any);
      if (!value) continue;
      out.push({ key: scalar((item as any).code ?? (item as any).id ?? label) ?? `${group}.${out.length}`, label, value, group });
    }
  } else if (arr && typeof arr === 'object' && !(arr instanceof Date)) {
    for (const [k, v] of Object.entries(arr as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const label = valueLabel(v as any) ?? k;
        const value = valueValue(v as any);
        if (value) out.push({ key: k, label, value, group });
        continue;
      }
      const value = scalar(v);
      if (value) out.push({ key: k, label: k, value, group });
    }
  }
}

const ROOT_CONSUMED = new Set([
  'docId', 'documentId', 'documentNo', 'responseText', 'id', 'docAuthor', 'coApplicants', 'docValues', 'docClassCalculatorValues', 'archDocMeta',
  'archDocType', 'attachedFiles', 'motions', 'docMotions', 'lastMotion', 'regNumber', 'registrationNumber', 'docNumber',
  'docName', 'title', 'name', 'address', 'objectAddress', 'naprCadCode', 'cadCode', 'cadastralCode', 'regDate',
  'registrationDate', 'createDate', 'docStatusName', 'statusName', 'status', 'description', 'projectDescription',
]);

/** Normalise one `getUserDocumentLastMotion` reply graph. */
export function normalizeCaseDetail(documentId: string, data: DwrValue, objectCount = 0): TasCaseDetail {
  const root = (data && typeof data === 'object' && !Array.isArray(data) && !(data instanceof Date) ? data : {}) as Record<string, any>;
  const parties: TasParty[] = [];
  const attachments = new Map<string, TasAttachment>();
  const motions = new Map<string, TasMotion>();
  const values: TasValue[] = [];
  const cadastral = new Set<string>();

  const author = root.docAuthor;
  if (author && typeof author === 'object') {
    const p = partyFrom(author, roleFromKey('docAuthor', author), '$.docAuthor');
    if (p) parties.push(p);
  }
  if (Array.isArray(root.coApplicants)) {
    root.coApplicants.forEach((c: any, i: number) => {
      if (!c || typeof c !== 'object') return;
      const p = partyFrom(c, roleFromKey('coApplicants', c), `$.coApplicants[${i}]`);
      if (p) parties.push(p);
    });
  }
  collectValues(root.docValues, 'docValues', values);
  collectValues(root.docClassCalculatorValues, 'docClassCalculatorValues', values);
  collectValues(root.archDocMeta, 'archDocMeta', values);

  walkObjects(data, (o, path) => {
    const fileId = o.attachedFileId ?? (/attachedFiles\[\d+\]$/.test(path) ? (o.id ?? o.fileId) : undefined);
    if (fileId !== undefined && fileId !== null && /^\d+$/.test(String(fileId))) {
      const id = String(fileId);
      const fileName = scalar(o.fileName ?? o.originalFileName ?? o.name ?? o.attachedFileName ?? o.fName);
      const motion = o.motionId ?? null;
      const prior = attachments.get(id);
      const att: TasAttachment = {
        attachedFileId: id,
        fileName,
        extension: extOf(fileName),
        contentType: scalar(o.contentType ?? o.mimeType ?? o.fileType),
        sizeBytes: typeof o.fileSize === 'number' ? o.fileSize : typeof o.size === 'number' ? o.size : null,
        motionId: motion === null || motion === undefined || motion === '' ? null : String(motion),
        fileIdOnStorage: o.fileIdOnStorage != null && o.fileIdOnStorage !== '' ? String(o.fileIdOnStorage) : null,
        date: toIsoDate(o.uploadDate ?? o.createDate ?? o.attachDate ?? o.date),
        description: scalar(o.description ?? o.fileDescription ?? o.typeName ?? o.attachmentTypeName),
        sourcePath: path,
      };
      // The same file can be cited from the case AND a motion. Keep one, and
      // prefer the richer record (a motion link beats none; a name beats none).
      if (!prior) attachments.set(id, att);
      else
        attachments.set(id, {
          ...prior,
          fileName: prior.fileName ?? att.fileName,
          extension: prior.extension ?? att.extension,
          contentType: prior.contentType ?? att.contentType,
          sizeBytes: prior.sizeBytes ?? att.sizeBytes,
          motionId: prior.motionId ?? att.motionId,
          fileIdOnStorage: prior.fileIdOnStorage ?? att.fileIdOnStorage,
          date: prior.date ?? att.date,
          description: prior.description ?? att.description,
        });
    }
    const mId = o.motionId;
    // A motion record is an object that carries its own motionId and is not
    // itself a file record.
    if (mId !== undefined && mId !== null && o.attachedFileId === undefined && /^\d+$/.test(String(mId))) {
      const id = String(mId);
      if (!motions.has(id))
        motions.set(id, {
          motionId: id,
          date: toIsoDate(o.motionDate ?? o.createDate ?? o.date ?? o.actionDate ?? o.startDate),
          name: scalar(o.motionName ?? o.name ?? o.actionName ?? o.typeName ?? o.motionTypeName),
          status: scalar(o.statusName ?? o.status ?? o.resultName),
          decisionNumber: scalar(o.decisionNumber ?? o.orderNumber ?? o.resolutionNumber ?? o.answerNumber),
          sourcePath: path,
        });
    }
    // Further participants wherever the graph names them.
    for (const [k, v] of Object.entries(o)) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || v instanceof Date) continue;
      if (k === 'docAuthor' && path === '$') continue;
      if (!/(architect|developer|client|owner|engineer|designer|contractor|supervisor|expert|author|applicant|representative)/i.test(k)) continue;
      const p = partyFrom(v as any, roleFromKey(k, v as any), `${path}.${k}`);
      if (p) parties.push(p);
    }
    for (const k of ['naprCadCode', 'cadCode', 'cadastralCode', 'cadastralNumber']) {
      const c = scalar(o[k]);
      if (c && /^\d{1,3}(\.\d{1,4}){2,}$/.test(c)) cadastral.add(c);
    }
  });

  // Motions referenced only by attachments still exist as motions.
  for (const a of attachments.values())
    if (a.motionId && !motions.has(a.motionId))
      motions.set(a.motionId, { motionId: a.motionId, date: null, name: null, status: null, decisionNumber: null, sourcePath: a.sourcePath });

  const unmapped: Record<string, string> = {};
  for (const [k, v] of Object.entries(root)) {
    if (ROOT_CONSUMED.has(k)) continue;
    const s = scalar(v);
    if (s) unmapped[k] = s.slice(0, 500);
  }

  const archType = root.archDocType;
  const docType =
    scalar(archType && typeof archType === 'object' ? (archType.name ?? archType.typeName ?? archType.title) : archType) ??
    scalar(root.docTypeName);

  return {
    documentId,
    docType,
    title: scalar(root.docName ?? root.title ?? root.name) ?? docType,
    registrationNumber: scalar(root.documentNo ?? root.regNumber ?? root.registrationNumber ?? root.docNumber),
    status: scalar(root.docStatusName ?? root.statusName ?? root.status),
    submittedAt: toIsoDate(root.regDate ?? root.registrationDate ?? root.createDate),
    lastMotionAt: [...motions.values()].map((m) => m.date).filter(Boolean).sort().pop() ?? null,
    address: scalar(root.address ?? root.objectAddress),
    cadastralCodes: [...cadastral],
    description: scalar(root.projectDescription ?? root.description),
    responseText: scalar(root.responseText),
    parties: dedupeParties(parties),
    values,
    attachments: [...attachments.values()].sort((a, b) => Number(a.attachedFileId) - Number(b.attachedFileId)),
    motions: [...motions.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || Number(a.motionId) - Number(b.motionId)),
    unmapped,
    objectCount,
  };
}

/** Same role + same normalised name + same org id → one party. Different
 * people with similar names are NEVER merged (no fuzzy matching here). */
export function dedupeParties(parties: TasParty[]): TasParty[] {
  const out = new Map<string, TasParty>();
  for (const p of parties) {
    const key = `${p.role.toLowerCase()}|${normalizeName(p.name)}|${p.organizationId ?? ''}`;
    if (!out.has(key)) out.set(key, p);
  }
  return [...out.values()];
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/["'«»„“”`]/g, '')
    .replace(/\b(შპს|სს|llc|jsc|ltd|ооо|оао|зао)\b/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────── payload classification ─────────────────────────────

export type PayloadKind = 'PDF' | 'HTML' | 'EMPTY' | 'IMAGE' | 'ARCHIVE' | 'CAD' | 'OFFICE' | 'OTHER' | 'FAILED';

export interface PayloadClass {
  kind: PayloadKind;
  /** A finer label: jpeg/png/rar/zip/dwg/pla/docx … */
  format: string | null;
}

/**
 * What a response actually is — from HTTP status, content type, magic bytes
 * and size, never from an assumption about the route.
 */
export function classifyPayload(input: { status: number; contentType?: string | null; bytes: Uint8Array; fileName?: string | null }): PayloadClass {
  const { status, bytes } = input;
  const ct = String(input.contentType ?? '').toLowerCase();
  const ext = extOf(input.fileName ?? null);
  if (!(status >= 200 && status < 300)) return { kind: 'FAILED', format: `http_${status}` };
  if (!bytes || bytes.length === 0) return { kind: 'EMPTY', format: null };
  const head = bytesToBuffer(bytes.subarray(0, 16));
  const ascii = head.toString('latin1');
  if (ascii.startsWith('%PDF')) return { kind: 'PDF', format: 'pdf' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'IMAGE', format: 'jpeg' };
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return { kind: 'IMAGE', format: 'png' };
  if (ascii.startsWith('GIF8')) return { kind: 'IMAGE', format: 'gif' };
  if (ascii.startsWith('II*\0') || ascii.startsWith('MM\0*')) return { kind: 'IMAGE', format: 'tiff' };
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return { kind: 'IMAGE', format: 'webp' };
  if (ascii.startsWith('BM')) return ext === 'bmp' ? { kind: 'IMAGE', format: 'bmp' } : { kind: 'OTHER', format: ext };
  if (ascii.startsWith('Rar!')) return { kind: 'ARCHIVE', format: 'rar' };
  if (ascii.startsWith('7z\xBC\xAF')) return { kind: 'ARCHIVE', format: '7z' };
  if (ascii.startsWith('AC10')) return { kind: 'CAD', format: 'dwg' };
  if (ascii.startsWith('PK\x03\x04') || ascii.startsWith('PK\x05\x06')) {
    if (ext && ['docx', 'xlsx', 'pptx', 'odt', 'ods'].includes(ext)) return { kind: 'OFFICE', format: ext };
    return { kind: 'ARCHIVE', format: 'zip' };
  }
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return { kind: 'OFFICE', format: ext ?? 'ole' };
  if (ext === 'pla' || ext === 'pln' || ext === 'dwg' || ext === 'dxf' || ext === 'rvt' || ext === 'ifc') return { kind: 'CAD', format: ext };
  const text = bytesToBuffer(bytes.subarray(0, 2048)).toString('utf8').trim();
  if (!text) return { kind: 'EMPTY', format: null };
  if (ct.includes('html') || /^<!doctype html|^<html|<body[\s>]/i.test(text)) {
    // An HTML shell with no body content is an empty answer, not a document.
    const visible = htmlToText(bytesToBuffer(bytes).toString('utf8'));
    return visible.length < 20 ? { kind: 'EMPTY', format: 'html' } : { kind: 'HTML', format: 'html' };
  }
  if (ct.includes('pdf')) return { kind: 'OTHER', format: 'pdf_mislabelled' };
  return { kind: 'OTHER', format: ext ?? (ct || null) };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export type PdfTextClass = 'READ_TEXT' | 'LOW_TEXT' | 'SCAN_OR_IMAGE_ONLY' | 'FAILED';

/** How much real text a parsed PDF yielded, per page. */
export function classifyPdfText(text: string | null, pages: number | null, failed = false): PdfTextClass {
  if (failed) return 'FAILED';
  const chars = (text ?? '').replace(/\s+/g, '').length;
  const n = Math.max(1, pages ?? 1);
  if (chars === 0) return 'SCAN_OR_IMAGE_ONLY';
  const perPage = chars / n;
  if (perPage >= 150) return 'READ_TEXT';
  if (perPage < 15) return 'SCAN_OR_IMAGE_ONLY';
  return 'LOW_TEXT';
}
