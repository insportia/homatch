// Minimal RFC4180-ish CSV parser (no external dependency).
//
// This project's sandbox cannot install new npm packages (registry access is
// blocked for every package, not just specific ones — confirmed by testing a
// fresh `npm install papaparse` in an empty directory, which 403'd exactly
// like every other install attempt this session). Task #63 (CRM contact
// import) needs a client-side CSV parser to feed the existing contact-import
// edge function's `raw_rows` array, so this hand-rolled parser exists to fill
// that gap rather than silently skipping the feature. It only handles CSV
// (comma-separated, RFC4180 quoting) — XLSX (a binary zip-based format) is
// not something worth hand-rolling, so ContactListsPage explicitly tells the
// user XLSX isn't supported yet and to export as CSV instead. That's a real,
// disclosed boundary, not a silent gap.

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Splits CSV text into rows of raw string cells, honoring quoted fields
 * (which may contain commas, newlines, and escaped "" quotes). */
export function parseCsvCells(text: string): string[][] {
  // Strip a leading UTF-8 BOM, which Excel/Sheets commonly prepend.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { pushField(); i++; continue; }
    if (c === '\r') { i++; continue; } // normalize CRLF -> LF below
    if (c === '\n') { pushRow(); i++; continue; }
    field += c; i++;
  }
  // Final field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop fully-empty trailing rows (common with a trailing newline)
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Parses CSV text into header-keyed row objects. The first non-empty row is
 * treated as the header. Returns at most `maxRows` data rows (header not
 * counted) — callers should surface `rows.length === maxRows` as "there may
 * be more, consider splitting the file" rather than silently truncating. */
export function parseCsv(text: string, maxRows = 5000): ParsedCsv {
  const cells = parseCsvCells(text);
  if (cells.length === 0) return { headers: [], rows: [] };
  const headers = cells[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < cells.length && rows.length < maxRows; i++) {
    const line = cells[i];
    if (line.length === 1 && line[0].trim() === '') continue; // skip blank lines
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (line[idx] ?? '').trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}
