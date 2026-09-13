// HOMATCH — reading a customer's contact file.
//
// §14. Phone is the only required field; names, surnames, emails and phone
// numbers are detected automatically; unrelated columns are ignored unless the
// user chooses to keep them.
//
// WHY EXCEL CELLS ARE READ AS TEXT
//
// The single most damaging thing a spreadsheet does to a phone column is treat
// it as a number. "+995599123456" becomes 995599123456, the plus is gone; a
// local number "0599123456" loses its leading zero; a long one renders as
// "9.95599e+11". None of that is recoverable afterwards by a parser, however
// good. It IS recoverable at the read, by asking the sheet for each cell's
// DISPLAYED text rather than its value, which is what parseXlsx does below.
//
// WHY .xls IS REFUSED RATHER THAN PARSED
//
// §14 and §149 list XLS alongside XLSX. The legacy BIFF format has no
// maintained, currently-patched pure-JavaScript parser: the one library that
// reads it ships on npm at a version with unfixed prototype-pollution and
// ReDoS advisories, and this code path parses files uploaded by strangers.
// Pulling that into the browser to save a customer one "Save As" is the wrong
// trade. So a .xls is DETECTED by its magic bytes and refused with an exact,
// actionable message, rather than being silently mis-parsed or quietly
// pulling in a known-vulnerable dependency.

import { detectColumns, applyMapping, type DetectedColumn } from './headerDetect.ts';
import { parsePhone, phoneDedupeKey, normalizeCountryCode, type ParsedPhone } from './phone.ts';

export type SourceFormat = 'CSV' | 'XLSX' | 'XLS_UNSUPPORTED' | 'UNKNOWN';

export interface ParsedSheet {
  format: SourceFormat;
  headers: string[];
  rows: string[][];
  /** Set when the file could not be read. The wizard shows this, not a stack trace. */
  error?: 'XLS_LEGACY' | 'EMPTY' | 'UNREADABLE' | 'TOO_LARGE';
}

/** A row's verdict, before anything is written. */
export type RowStatus = 'VALID' | 'REVIEW' | 'INVALID' | 'DUPLICATE' | 'SUPPRESSED';

export interface PreparedRow {
  index: number;
  status: RowStatus;
  reason?: string;
  phone: ParsedPhone;
  fields: Record<string, string>;
}

export interface ImportSummary {
  total: number;
  valid: number;
  review: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
  byCountry: Record<string, number>;
  byLanguage: Record<string, number>;
}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;

export function detectFormat(file: { name: string; type?: string }): SourceFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return 'CSV';
  if (name.endsWith('.xlsx')) return 'XLSX';
  if (name.endsWith('.xls')) return 'XLS_UNSUPPORTED';
  if (file.type?.includes('csv')) return 'CSV';
  if (file.type?.includes('spreadsheetml')) return 'XLSX';
  return 'UNKNOWN';
}

/**
 * Magic bytes, because an extension is a claim and not a fact.
 *
 *   XLSX  a ZIP container: 50 4B ("PK")
 *   XLS   OLE2 compound document: D0 CF 11 E0 A1 B1 1A E1
 *
 * A .xls renamed to .xlsx is the common case and would otherwise fail deep
 * inside the ZIP reader with something unreadable.
 */
export function sniffFormat(head: Uint8Array): SourceFormat | null {
  if (head.length >= 8
    && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
    && head[4] === 0xa1 && head[5] === 0xb1 && head[6] === 0x1a && head[7] === 0xe1) {
    return 'XLS_UNSUPPORTED';
  }
  if (head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) return 'XLSX';
  return null;
}

/**
 * A CSV parser that handles the things real exports contain: quoted fields,
 * embedded commas, embedded newlines, doubled quotes, a UTF-8 BOM, and
 * semicolon or tab delimiters.
 *
 * Written rather than imported because the alternative is a dependency for
 * ninety lines of well-understood state machine, and because the delimiter
 * sniffing below is specific to this problem.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  const delimiter = sniffDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      // A blank line between records is formatting, not an empty contact.
      if (row.some((c) => c.trim())) rows.push(row);
      row = []; field = '';
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows: rows.slice(0, MAX_ROWS) };
}

/** The delimiter that produces the most consistent column count over the first lines. */
function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).filter(Boolean);
  if (!sample.length) return ',';
  let best = ','; let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((line) => line.split(d).length);
    const first = counts[0];
    // Consistency across lines matters more than raw count: a line with
    // sixteen commas inside quoted addresses is not a sixteen-column file.
    const consistent = counts.every((c) => c === first) ? 2 : 0;
    const score = (first > 1 ? first : 0) + consistent;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * Read an .xlsx.
 *
 * read-excel-file is loaded on demand: §85 forbids putting a spreadsheet
 * parser on the homepage's initial path, and a visitor who never imports
 * anything should never download it.
 */
export async function parseXlsx(file: Blob): Promise<{ headers: string[]; rows: string[][] }> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');

  /*
   * EVERY .xlsx IMPORT FAILED HERE, FOR EVERY FILE.
   *
   * This used to assert, in a comment, that the library returns "a plain array
   * of rows of cells". read-excel-file 9.x does not: it returns one entry per
   * worksheet, `[{ sheet, data }]`. So `.map(row => row.map(...))` was calling
   * .map on a worksheet OBJECT, which threw, which readFile caught, which the
   * wizard showed as "this file could not be read" — for every spreadsheet
   * anyone ever uploaded.
   *
   * Found by uploading a real .xlsx to production rather than by reading this
   * function, which is the only way it could have been found: the assumption
   * was stated as a fact in a comment, and the failure was swallowed into a
   * generic message.
   *
   * Both shapes are accepted now. The library has returned each of them across
   * versions, and this file should not break again the next time it changes
   * its mind.
   */
  const parsed = (await readXlsxFile(file as File)) as unknown;
  const grid = extractGrid(parsed);

  const asText = grid.map((row) => row.map(cellToText));
  const headers = (asText.shift() ?? []).map((h: string) => h.trim());
  return { headers, rows: asText.slice(0, MAX_ROWS) };
}

/** Rows, whether the reader handed back rows or a list of worksheets. */
function extractGrid(parsed: unknown): unknown[][] {
  if (!Array.isArray(parsed)) return [];
  const first = parsed[0];
  // A list of worksheets: take the first sheet's rows.
  if (first && !Array.isArray(first) && typeof first === 'object' && Array.isArray((first as { data?: unknown }).data)) {
    return (first as { data: unknown[][] }).data;
  }
  // Already rows.
  return parsed as unknown[][];
}

/**
 * A cell as a person would see it.
 *
 * The Date branch matters: a column of dates read as Date objects and then
 * stringified gives "Mon Jan 01 2024 00:00:00 GMT+0400", which is neither what
 * the sheet showed nor anything useful.
 */
function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'number') {
    // Never exponential notation, and never a spurious decimal tail.
    return Number.isInteger(cell) ? String(BigInt(Math.trunc(cell))) : String(cell);
  }
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  return String(cell);
}

export async function readFile(file: File): Promise<ParsedSheet> {
  if (file.size > MAX_BYTES) {
    return { format: 'UNKNOWN', headers: [], rows: [], error: 'TOO_LARGE' };
  }

  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sniffed = sniffFormat(head);
  const format = sniffed ?? detectFormat(file);

  if (format === 'XLS_UNSUPPORTED') {
    // Named and explained. A silent failure here is a customer concluding the
    // product is broken when their file simply needs re-saving.
    return { format, headers: [], rows: [], error: 'XLS_LEGACY' };
  }

  try {
    if (format === 'XLSX') {
      const { headers, rows } = await parseXlsx(file);
      if (!rows.length) return { format, headers, rows, error: 'EMPTY' };
      return { format, headers, rows };
    }
    const { headers, rows } = parseCsv(await file.text());
    if (!rows.length) return { format: 'CSV', headers, rows, error: 'EMPTY' };
    return { format: 'CSV', headers, rows };
  } catch {
    return { format, headers: [], rows: [], error: 'UNREADABLE' };
  }
}

export interface PrepareOptions {
  defaultCountry?: string | null;
  /** E.164 numbers already on this account, so a duplicate is recognised. */
  existingPhones?: Set<string>;
  /** E.164 numbers that must never be re-imported as contactable (§14 step 5). */
  suppressedPhones?: Set<string>;
}

/**
 * Turn raw rows into decided ones.
 *
 * §14 step 5's hard rule is the last branch: an opted-out, do-not-contact or
 * suppressed number is NEVER re-enabled by an import. It is recognised,
 * counted and reported as suppressed, and the row does not become a
 * contactable contact. The most common way a platform mails someone who asked
 * it to stop is re-importing a list.
 */
export function prepareRows(
  rows: string[][],
  columns: DetectedColumn[],
  options: PrepareOptions = {},
): { prepared: PreparedRow[]; summary: ImportSummary } {
  const seen = new Set<string>();
  const prepared: PreparedRow[] = [];

  const summary: ImportSummary = {
    total: rows.length, valid: 0, review: 0, invalid: 0,
    duplicates: 0, suppressed: 0, byCountry: {}, byLanguage: {},
  };

  const defaultCountry = normalizeCountryCode(options.defaultCountry);

  rows.forEach((row, index) => {
    const fields = applyMapping(row, columns);
    // A country COLUMN on the row beats the import-wide default, because a
    // mixed list is exactly why that column exists.
    const rowCountry = normalizeCountryCode(fields.country) ?? defaultCountry;
    const phone = parsePhone(fields.phone ?? '', rowCountry);

    let status: RowStatus = 'VALID';
    let reason: string | undefined;

    if (!phone.e164 || !phone.valid) {
      status = phone.e164 ? 'REVIEW' : 'INVALID';
      reason = phone.reason ?? 'NO_PHONE';
    }

    const key = phoneDedupeKey(phone);
    if (key && status !== 'INVALID') {
      if (options.suppressedPhones?.has(key)) {
        status = 'SUPPRESSED';
        reason = 'PREVIOUSLY_OPTED_OUT';
      } else if (seen.has(key) || options.existingPhones?.has(key)) {
        status = 'DUPLICATE';
        reason = seen.has(key) ? 'DUPLICATE_IN_FILE' : 'ALREADY_IMPORTED';
      } else {
        seen.add(key);
      }
    }

    prepared.push({ index, status, reason, phone, fields });

    if (status === 'VALID') summary.valid++;
    else if (status === 'REVIEW') summary.review++;
    else if (status === 'INVALID') summary.invalid++;
    else if (status === 'DUPLICATE') summary.duplicates++;
    else if (status === 'SUPPRESSED') summary.suppressed++;

    if (phone.country) summary.byCountry[phone.country] = (summary.byCountry[phone.country] ?? 0) + 1;
    const lang = (fields.language ?? '').toLowerCase().slice(0, 2);
    if (lang) summary.byLanguage[lang] = (summary.byLanguage[lang] ?? 0) + 1;
  });

  return { prepared, summary };
}

/** Analyse a file end to end: detect columns, then decide every row. */
export function analyseSheet(sheet: ParsedSheet, options: PrepareOptions = {}) {
  const detection = detectColumns(sheet.headers, sheet.rows);
  const { prepared, summary } = prepareRows(sheet.rows, detection.columns, options);
  return { detection, prepared, summary };
}

/** §109's sample file, generated rather than shipped, with obviously fake data. */
export function sampleCsv(): string {
  const rows = [
    ['phone', 'first_name', 'last_name', 'email', 'language', 'country'],
    ['+995599123456', 'Nino', 'Beridze', 'nino.beridze@example.com', 'ka', 'GE'],
    ['+995577987654', 'Giorgi', 'Kapanadze', 'giorgi.k@example.com', 'ka', 'GE'],
    ['+79161234567', 'Anna', 'Ivanova', 'anna.ivanova@example.com', 'ru', 'RU'],
    ['+905321234567', 'Mehmet', 'Yilmaz', 'mehmet.yilmaz@example.com', 'tr', 'TR'],
    ['+442079460958', 'Sarah', 'Collins', 'sarah.collins@example.com', 'en', 'GB'],
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
