// RsTaxpayerResponse.ts — PURE (no Playwright) reading of RS.ge's own answer
// to a taxpayer search: the GrdSearchTaxPayers XHR the registry page fires
// when "ძიება" is pressed.
//
// WHY THIS EXISTS (Railway logs 2026-10-10..11, 18 of 18 runs): 2Captcha
// returned a token every time, the page accepted it, the search XHR
// /RsGe.Module/TaxpayersRegistry/GrdSearchTaxPayers answered 200 — and the
// worker still reported NO_CHANGE, because it judged the outcome from the
// page TEXT, where the warning left by Search #1 was still on screen. The
// verdict now comes from the server's answer itself:
//
//   ACCEPTED     the answer carries at least one taxpayer row
//   NO_RESULT    a valid, empty answer (the registry has no such record)
//   REJECTED     the server says the verification failed (by its content)
//   UNPARSEABLE  200, but neither rows, an empty grid nor a rejection
//   HTTP_ERROR   a non-2xx status
//   NETWORK_ERROR the request never got an answer
//
// Every column RS.ge returns is kept: the known ones are mapped onto
// RsTaxpayerPublicData, every other one is kept, labelled, in
// otherPublicFields. Nothing here logs or stores the TIN unmasked.
import type { RsTaxpayerPublicData } from '../WorkflowResult.js';

/** The registry's own search endpoint (path only, matched case-insensitively). */
export const RS_GRID_PATH = /\/TaxpayersRegistry\/GrdSearchTaxPayers/i;
/** Cap on the redacted raw answer kept for diagnosis (bytes, UTF-8). */
export const RS_RAW_MAX_BYTES = 20_000;

export type RsServerOutcome = 'ACCEPTED' | 'NO_RESULT' | 'REJECTED' | 'UNPARSEABLE' | 'HTTP_ERROR' | 'NETWORK_ERROR';
/** The customer-facing verification state of one RS.ge check. */
export type RsVerificationStatus = 'VERIFIED' | 'PENDING_VERIFICATION' | 'TEMPORARILY_UNAVAILABLE' | 'VERIFICATION_FAILED';
export type RsResponseFormat = 'JSON' | 'HTML' | 'TEXT' | 'EMPTY';

/** One captured answer of the search endpoint. */
export interface RsGridCapture {
  status: number;
  contentType: string | null;
  body: string | null;
  /** Set when the request failed before any answer (DNS, reset, timeout). */
  networkError?: string | null;
  /** Whether the request (URL or post body) carried the searched identifier. Null = unknown. */
  requestHadTin?: boolean | null;
}

export interface RsGridClassification {
  outcome: RsServerOutcome;
  format: RsResponseFormat | null;
  rows: Array<Record<string, string>>;
  /** Column / property names seen in the rows (names only — safe to log). */
  columns: string[];
  /** The server's own total, when it states one. */
  total: number | null;
  /** Short machine reason, never page text. */
  reason: string | null;
}

/** What RS.ge says when a search is refused for verification (content, not the stale DOM). */
const REJECT_RE = /უსაფრთხოების\s*ღილაკ|recaptcha|captcha|რობოტ|verification\s*failed|invalid\s*(?:captcha|token)|ვერიფიკაცი/i;
/** An explicit empty answer. */
const EMPTY_RE = /ჩანაწერ(?:ი|ები)\s*(?:ვერ|არ)\s*მოიძებნ|ვერ\s*მოიძებნა|არ\s*მოიძებნა|no\s*(?:records?|results?|data)(?:\s*(?:were\s*)?found|\s*to\s*display|\s*available)?|nothing\s*found|не\s*найдено/i;

const ROW_KEYS = ['Data', 'data', 'Rows', 'rows', 'Items', 'items', 'Result', 'result', 'Results', 'results', 'aaData', 'records', 'Records', 'd'];
const TOTAL_KEYS = ['Total', 'total', 'TotalCount', 'totalCount', 'recordsTotal', 'recordsFiltered', 'Count', 'count'];
/** Technical keys a grid adds that say nothing about the taxpayer. */
const TECHNICAL_KEY = /^(?:__.*|\$.*|uid|row_?num(?:ber)?|_?rn)$/i;

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A JSON value as display text; ASP.NET's /Date(ms)/ and ISO stamps become a day. */
export function rsValueText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'string') {
    const ms = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(v.trim());
    if (ms) {
      const d = new Date(Number(ms[1]));
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    const isoStamp = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(v.trim());
    if (isoStamp) return isoStamp[1];
    const s = v.replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 300) : null;
  }
  if (Array.isArray(v)) {
    const parts = v.map(rsValueText).filter(Boolean) as string[];
    return parts.length ? parts.join(', ').slice(0, 300) : null;
  }
  if (isPlainObject(v)) {
    // A nested lookup ({Id, Name}) reads as its name.
    for (const k of ['Name', 'name', 'Text', 'text', 'Title', 'title', 'Value', 'value']) if (typeof v[k] === 'string' && v[k]) return rsValueText(v[k]);
    return null;
  }
  return null;
}

function flattenRow(o: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o).slice(0, 80)) {
    if (TECHNICAL_KEY.test(k)) continue;
    const t = rsValueText(v);
    if (t !== null && t !== '') out[k] = t;
  }
  return out;
}

const isRowArray = (v: unknown): v is unknown[] => Array.isArray(v) && v.every((x) => isPlainObject(x));

/** The row array of a JSON answer: a known key first, then any array of objects (bounded walk). */
function findRows(v: unknown, depth = 0): { rows: Record<string, unknown>[]; total: number | null } | null {
  if (isRowArray(v)) return { rows: v as Record<string, unknown>[], total: null };
  if (!isPlainObject(v) || depth > 4) return null;
  let total: number | null = null;
  for (const k of TOTAL_KEYS) {
    const n = typeof v[k] === 'number' ? (v[k] as number) : typeof v[k] === 'string' && /^\d+$/.test(v[k] as string) ? Number(v[k]) : null;
    if (n !== null) {
      total = n;
      break;
    }
  }
  for (const k of ROW_KEYS) {
    if (!(k in v)) continue;
    const inner = v[k];
    if (isRowArray(inner)) return { rows: inner as Record<string, unknown>[], total };
    const deeper = findRows(inner, depth + 1);
    if (deeper) return { rows: deeper.rows, total: deeper.total ?? total };
  }
  for (const inner of Object.values(v)) {
    if (Array.isArray(inner) && inner.length && isRowArray(inner)) return { rows: inner as Record<string, unknown>[], total };
    if (isPlainObject(inner)) {
      const deeper = findRows(inner, depth + 1);
      if (deeper) return { rows: deeper.rows, total: deeper.total ?? total };
    }
  }
  return null;
}

/** Every string value in a JSON answer (bounded), for content checks. */
function jsonText(v: unknown, out: string[] = [], depth = 0): string[] {
  if (out.length > 200 || depth > 6) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v.slice(0, 100)) jsonText(x, out, depth + 1);
  else if (isPlainObject(v)) for (const x of Object.values(v).slice(0, 100)) jsonText(x, out, depth + 1);
  return out;
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'" };
export function htmlText(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Rows of the first data table of an HTML fragment (header from <th>, else the first row). */
function htmlTableRows(html: string): { rows: Array<Record<string, string>>; emptyRow: boolean } {
  const out: Array<Record<string, string>> = [];
  let emptyRow = false;
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    const parsed = trs.map((tr) => {
      const cells = [...tr.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => ({ th: m[1].toLowerCase() === 'th', text: htmlText(m[2]).replace(/\s+/g, ' ').trim() }));
      return cells;
    }).filter((c) => c.length);
    if (!parsed.length) continue;
    // A vertical "label | value" table: one record.
    if (parsed.every((c) => c.length === 2) && !parsed[0].every((x) => x.th)) {
      const rec: Record<string, string> = {};
      for (const [l, v] of parsed) if (l.text && v.text) rec[l.text.replace(/[:։]\s*$/, '')] = v.text.slice(0, 300);
      if (Object.keys(rec).length >= 2) {
        out.push(rec);
        break;
      }
    }
    const headerIdx = parsed.findIndex((c) => c.every((x) => x.th));
    const header = headerIdx >= 0 ? parsed[headerIdx].map((x) => x.text) : parsed[0].map((x) => x.text);
    const body = parsed.slice((headerIdx >= 0 ? headerIdx : 0) + 1).filter((c) => !c.every((x) => x.th));
    for (const cells of body) {
      if (cells.length === 1 && cells[0].text && EMPTY_RE.test(cells[0].text)) {
        emptyRow = true;
        continue;
      }
      if (cells.every((x) => !x.text)) continue;
      const rec: Record<string, string> = {};
      cells.forEach((x, i) => {
        const label = header[i] || `column_${i + 1}`;
        if (x.text) rec[label] = x.text.slice(0, 300);
      });
      if (Object.keys(rec).length) out.push(rec);
    }
    if (out.length) break;
  }
  return { rows: out, emptyRow };
}

const columnsOf = (rows: Array<Record<string, string>>): string[] => [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 80);

/** Classify one captured answer from the server's own content. */
export function classifyRsGridResponse(c: RsGridCapture): RsGridClassification {
  const base = { rows: [] as Array<Record<string, string>>, columns: [] as string[], total: null as number | null };
  if (c.networkError || !c.status) return { ...base, outcome: 'NETWORK_ERROR', format: null, reason: 'NO_ANSWER' };
  if (c.status < 200 || c.status >= 300) return { ...base, outcome: 'HTTP_ERROR', format: null, reason: `HTTP_${c.status}` };
  const body = String(c.body ?? '').replace(/^﻿/, '').trim();
  if (!body) return { ...base, outcome: 'UNPARSEABLE', format: 'EMPTY', reason: 'EMPTY_BODY' };

  let json: unknown = undefined;
  if (/^[[{"]/.test(body)) {
    try {
      json = JSON.parse(body);
    } catch {
      json = undefined;
    }
  }
  // ASP.NET wraps the payload as {d: "<json or html>"}; a bare JSON string is the same.
  for (let i = 0; i < 2; i++) {
    const inner = typeof json === 'string' ? json : isPlainObject(json) && typeof json.d === 'string' && Object.keys(json).length <= 2 ? json.d : null;
    if (inner === null) break;
    const t = inner.trim();
    if (/^[[{]/.test(t)) {
      try {
        json = JSON.parse(t);
        continue;
      } catch {
        /* fall through to HTML/text */
      }
    }
    return classifyMarkup(t, base);
  }

  if (json !== undefined) {
    const found = findRows(json);
    const texts = jsonText(json).join('\n');
    const errorsField = isPlainObject(json) ? json.Errors ?? json.errors ?? json.error ?? json.Error ?? null : null;
    const failedFlag = isPlainObject(json) && (json.success === false || json.Success === false || json.IsSuccess === false);
    if (found && found.rows.length) {
      const rows = found.rows.map(flattenRow).filter((r) => Object.keys(r).length);
      if (rows.length) return { outcome: 'ACCEPTED', format: 'JSON', rows, columns: columnsOf(rows), total: found.total ?? rows.length, reason: null };
    }
    if (REJECT_RE.test(texts) || ((errorsField || failedFlag) && REJECT_RE.test(JSON.stringify(errorsField ?? '')))) {
      return { ...base, outcome: 'REJECTED', format: 'JSON', reason: 'SERVER_VERIFICATION_REFUSED' };
    }
    const hasErrors = (isPlainObject(errorsField) && Object.keys(errorsField).length > 0) || (Array.isArray(errorsField) && errorsField.length > 0) || (typeof errorsField === 'string' && errorsField.trim() !== '');
    if (hasErrors || failedFlag) return { ...base, outcome: 'UNPARSEABLE', format: 'JSON', reason: 'SERVER_ERROR_FIELD' };
    if (found && found.rows.length === 0) return { ...base, total: found.total ?? 0, outcome: 'NO_RESULT', format: 'JSON', reason: null };
    if (EMPTY_RE.test(texts)) return { ...base, outcome: 'NO_RESULT', format: 'JSON', reason: 'EMPTY_MESSAGE' };
    return { ...base, outcome: 'UNPARSEABLE', format: 'JSON', reason: 'NO_ROW_ARRAY' };
  }
  return classifyMarkup(body, base);
}

function classifyMarkup(body: string, base: { rows: Array<Record<string, string>>; columns: string[]; total: number | null }): RsGridClassification {
  const isHtml = /<\s*(table|tr|td|div|span|p|html|body)\b/i.test(body);
  if (isHtml) {
    const { rows, emptyRow } = htmlTableRows(body);
    if (rows.length) return { outcome: 'ACCEPTED', format: 'HTML', rows, columns: columnsOf(rows), total: rows.length, reason: null };
    const text = htmlText(body);
    if (REJECT_RE.test(text)) return { ...base, outcome: 'REJECTED', format: 'HTML', reason: 'SERVER_VERIFICATION_REFUSED' };
    if (emptyRow || EMPTY_RE.test(text) || /k-grid-norecords/i.test(body)) return { ...base, total: 0, outcome: 'NO_RESULT', format: 'HTML', reason: null };
    return { ...base, outcome: 'UNPARSEABLE', format: 'HTML', reason: 'NO_TABLE_ROWS' };
  }
  const text = body.replace(/\s+/g, ' ');
  if (REJECT_RE.test(text)) return { ...base, outcome: 'REJECTED', format: 'TEXT', reason: 'SERVER_VERIFICATION_REFUSED' };
  if (EMPTY_RE.test(text)) return { ...base, total: 0, outcome: 'NO_RESULT', format: 'TEXT', reason: null };
  return { ...base, outcome: 'UNPARSEABLE', format: 'TEXT', reason: 'UNKNOWN_TEXT' };
}

/* ───────────── columns → RsTaxpayerPublicData ───────────── */

type KnownField = Exclude<keyof RsTaxpayerPublicData, 'otherPublicFields'>;
/** Order matters: VAT before status ("დღგ სტატუსი"), the code before the name. */
const FIELD_MATCHERS: Array<[KnownField, RegExp]> = [
  ['vatStatus', /დღგ|^(?:is_?)?vat|^dgg|vat_?(?:payer|status)/i],
  ['identificationCode', /საიდენტიფიკაციო|პირადი\s*ნომ|^ს\/?ნ$|^(?:tin|taxpayer_?id|tax_?id|tax_?code|ident(?:ification)?_?(?:code|no|number)|id_?code|code|saidcode|personal_?(?:no|number)|pid|un_?id|reg_?(?:no|number))$/i],
  ['registrationDate', /რეგისტრაციის\s*თარიღ|^(?:reg(?:istration)?_?(?:date|dt)|registered_?(?:on|at|date)?|create_?date|reg_?dat)$/i],
  ['legalForm', /სამართლებრივი\s*ფორმ|ორგანიზაციულ|^(?:legal_?form(?:_?name)?|org_?form|form_?name|sam_?forma|legal_?type)$/i],
  ['address', /მისამართ|^(?:address|legal_?address|addr|full_?address|misamarti|juridical_?address)$/i],
  ['taxpayerName', /დასახელება|სახელწოდება|^სახელი|^(?:name|full_?name|taxpayer_?name|org_?name|company_?name|title|dasaxeleba|payer_?name)$/i],
  ['status', /სტატუს|მდგომარეობ|^(?:status|state|status_?name|taxpayer_?status|status_?text)$/i],
];

/** The row that describes the searched identifier (else the first). */
export function pickRsRow(rows: Array<Record<string, string>>, idCode: string | null): Record<string, string> | null {
  if (!rows.length) return null;
  const id = String(idCode ?? '').replace(/\D/g, '');
  if (id) {
    const hit = rows.find((r) => Object.values(r).some((v) => String(v).replace(/\D/g, '') === id));
    if (hit) return hit;
  }
  return rows[0];
}

/** Map one grid row onto the public record: known columns by name, every other column kept, labelled. */
export function mapRsRow(row: Record<string, string>, idCode: string | null): RsTaxpayerPublicData {
  const out: RsTaxpayerPublicData = { identificationCode: null, taxpayerName: null, legalForm: null, status: null, registrationDate: null, vatStatus: null, address: null, otherPublicFields: {} };
  for (const [label, raw] of Object.entries(row)) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const field = FIELD_MATCHERS.find(([f, re]) => re.test(label.trim()) && out[f] === null)?.[0];
    if (field) out[field] = value.slice(0, 300);
    else if (Object.keys(out.otherPublicFields).length < 40) out.otherPublicFields[label.slice(0, 80)] = value.slice(0, 300);
  }
  if (!out.identificationCode && idCode && Object.values(row).some((v) => String(v).replace(/\D/g, '') === idCode.replace(/\D/g, ''))) out.identificationCode = idCode;
  return out;
}

/* ───────────── redaction ───────────── */

/** The identifier, masked: first two and last two digits only. */
export function maskTin(tin: string): string {
  const d = String(tin).replace(/\s/g, '');
  if (d.length <= 4) return '*'.repeat(d.length);
  return d.slice(0, 2) + '*'.repeat(d.length - 4) + d.slice(-2);
}

/**
 * Redact a raw answer for storage: the searched TIN is masked, every other
 * 11-digit personal number is masked, and long token-like strings are
 * dropped. Then bounded to RS_RAW_MAX_BYTES (UTF-8).
 */
export function redactRsRaw(body: string | null, tin: string | null): { text: string | null; bytes: number; truncated: boolean } {
  if (body === null || body === undefined) return { text: null, bytes: 0, truncated: false };
  const enc = new TextEncoder();
  const bytes = enc.encode(body).length;
  let s = String(body);
  const id = String(tin ?? '').trim();
  if (id.length >= 5) s = s.split(id).join(maskTin(id));
  s = s.replace(/(?<!\d)\d{11}(?!\d)/g, (m) => maskTin(m));
  s = s.replace(/[A-Za-z0-9_-]{120,}/g, '[REDACTED_TOKEN]');
  let truncated = false;
  if (enc.encode(s).length > RS_RAW_MAX_BYTES) {
    truncated = true;
    // Characters are up to 3 bytes; cut by characters until within the byte cap.
    let n = Math.min(s.length, RS_RAW_MAX_BYTES);
    while (n > 0 && enc.encode(s.slice(0, n)).length > RS_RAW_MAX_BYTES) n = Math.floor(n * 0.9);
    s = s.slice(0, n);
  }
  return { text: s, bytes, truncated };
}

/* ───────────── the stored verification record ───────────── */

/** What every RS.ge run stores, on every outcome, so a failure is diagnosable. */
export interface RsVerificationRecord {
  status: RsVerificationStatus;
  serverOutcome: RsServerOutcome | 'NO_RESPONSE' | 'NOT_SEARCHED';
  httpStatus: number | null;
  responseFormat: RsResponseFormat | null;
  rowCount: number | null;
  /** Field names RS.ge returned (names only). */
  columns: string[];
  /** Redacted (TIN masked), bounded raw answer — moved to evidence storage by the queue executor. */
  rawResponse: string | null;
  rawResponseBytes: number;
  rawTruncated: boolean;
  requestHadTin: boolean | null;
  reason: string | null;
  checkedAt: string;
  sourceUrl: string;
}

/** Server outcome → the four customer-facing states. */
export function rsStatusForOutcome(outcome: RsServerOutcome | 'NO_RESPONSE' | 'NOT_SEARCHED', httpStatus: number | null = null): RsVerificationStatus {
  switch (outcome) {
    case 'ACCEPTED':
    case 'NO_RESULT':
      return 'VERIFIED';
    case 'NETWORK_ERROR':
      return 'TEMPORARILY_UNAVAILABLE';
    case 'HTTP_ERROR':
      return httpStatus !== null && (httpStatus >= 500 || httpStatus === 429 || httpStatus === 408) ? 'TEMPORARILY_UNAVAILABLE' : 'VERIFICATION_FAILED';
    case 'REJECTED':
    case 'UNPARSEABLE':
      return 'VERIFICATION_FAILED';
    case 'NO_RESPONSE':
      return 'TEMPORARILY_UNAVAILABLE';
    default:
      return 'PENDING_VERIFICATION';
  }
}

export function buildRsVerificationRecord(input: {
  capture: RsGridCapture | null;
  classification: RsGridClassification | null;
  tin: string | null;
  sourceUrl: string;
  status?: RsVerificationStatus;
  serverOutcome?: RsVerificationRecord['serverOutcome'];
  reason?: string | null;
  now?: Date;
}): RsVerificationRecord {
  const cls = input.classification;
  const outcome = input.serverOutcome ?? cls?.outcome ?? 'NO_RESPONSE';
  const http = input.capture ? input.capture.status || null : null;
  const raw = redactRsRaw(input.capture?.body ?? null, input.tin);
  return {
    status: input.status ?? rsStatusForOutcome(outcome, http),
    serverOutcome: outcome,
    httpStatus: http,
    responseFormat: cls?.format ?? null,
    rowCount: cls ? cls.rows.length : null,
    columns: cls?.columns ?? [],
    rawResponse: raw.text,
    rawResponseBytes: raw.bytes,
    rawTruncated: raw.truncated,
    requestHadTin: input.capture?.requestHadTin ?? null,
    reason: input.reason ?? cls?.reason ?? null,
    checkedAt: (input.now ?? new Date()).toISOString(),
    sourceUrl: input.sourceUrl,
  };
}

/**
 * May a reading of the PAGE decide this search? Only when RS.ge's own answer
 * was not captured, or was itself a record / an empty grid. A captured answer
 * that is unreadable (or a refusal) leaves the grid in its empty state —
 * "Not found", 0 rows — which is NOT RS.ge saying there is no taxpayer.
 * Production 2026-10-22, company 405456359 (a registered LLC): a ~700-byte
 * JSON answer with no grid, a page reading "Not found", recorded as a
 * confirmed no-record. A parsed record on the page is still accepted: it
 * carries the taxpayer's own fields, which an empty grid cannot.
 */
export function rsPageReadDecides(cls: RsGridClassification | null, page: 'NO_RESULT_CONFIRMED' | 'SEARCH_CONFIRMED'): boolean {
  if (!cls || cls.outcome === 'ACCEPTED' || cls.outcome === 'NO_RESULT') return true;
  return page === 'SEARCH_CONFIRMED' && cls.outcome !== 'REJECTED';
}

/**
 * A stored record that says VERIFIED / NO_RESULT only because the page read
 * "no result" while RS.ge's captured answer was unreadable (reason
 * PAGE_READ_UNPARSEABLE, PAGE_READ_HTTP_ERROR …). Workers wrote these before
 * rsPageReadDecides(); such a record is not a confirmed absence.
 */
export function rsDomOnlyNoResult(rec: { status?: unknown; serverOutcome?: unknown; reason?: unknown } | null | undefined): boolean {
  if (!rec || rec.status !== 'VERIFIED' || rec.serverOutcome !== 'NO_RESULT') return false;
  return /^PAGE_READ_(?!NO_RESULT$|ACCEPTED$)[A-Z_]+$/.test(String(rec.reason ?? ''));
}

/** The log-safe view of a record: names, counts and codes — never values, never the raw answer. */
export function rsRecordLogFields(r: RsVerificationRecord): Record<string, unknown> {
  return { status: r.status, serverOutcome: r.serverOutcome, httpStatus: r.httpStatus, format: r.responseFormat, rowCount: r.rowCount, columns: r.columns, rawBytes: r.rawResponseBytes, requestHadTin: r.requestHadTin, reason: r.reason };
}
