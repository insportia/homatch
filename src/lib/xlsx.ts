// HOMATCH — writing a real .xlsx, with no library.
//
// WHY THIS EXISTS
//
// §80 and §81 ask for professional spreadsheets: a title, the filters that
// produced the data, real number and date formats, totals, a frozen header.
// The project has `read-excel-file` for reading and nothing for writing, and
// a CSV cannot carry any of that — a developer who opens a CSV of sale prices
// gets a column of unformatted numbers and dates their spreadsheet guesses
// the meaning of, differently depending on their locale.
//
// An .xlsx is a zip of XML. Neither is large. The zip here writes STORED
// entries (no compression), which is a valid zip that every reader opens; the
// files are kilobytes of text and the compression would save nothing worth a
// dependency.
//
// WHAT IS DELIBERATELY NOT HERE
//
// No formulas, no macros, no embedded objects — writing, and elsewhere in
// this product reading, §42: a customer's own template contributes HEADERS
// and a column order, and nothing executable ever survives a round trip
// through Homatch.

export type CellValue = string | number | boolean | Date | null | undefined;

export type ColumnFormat = 'text' | 'number' | 'integer' | 'currency' | 'date' | 'percent';

export interface SheetColumn {
  header: string;
  /** Key into each row object. */
  field: string;
  format?: ColumnFormat;
  /** Width in characters. Sensible defaults per format when omitted. */
  width?: number;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, CellValue>>;
  /** Printed above the table, in bold. */
  title?: string;
  /** One line per entry: "Project: Villion Tower", "Generated: 2026-09-15". */
  subtitles?: string[];
  /** Fields to sum in a totals row under the table. */
  totals?: string[];
}

// ── XML ────────────────────────────────────────────────────────────────────

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal in XML 1.0 and a pasted cell can carry
    // them. Dropping them is better than producing a file Excel refuses.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Excel counts days from 1899-12-30. The offset is not a typo: Excel treats
 * 1900 as a leap year for compatibility with Lotus 1-2-3, and 1899-12-30 is
 * the epoch that makes every date after 1900-03-01 come out right.
 */
export function excelSerial(date: Date): number {
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

function parseDate(value: CellValue): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value.length > 10 ? value : `${value}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Style indices, matching the cellXfs order in STYLES below.
const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_NUMBER = 3;
const STYLE_CURRENCY = 4;
const STYLE_TITLE = 5;
const STYLE_SUBTITLE = 6;
const STYLE_INTEGER = 7;
const STYLE_PERCENT = 8;
const STYLE_TOTAL_LABEL = 9;
const STYLE_TOTAL_CURRENCY = 10;

function styleFor(format: ColumnFormat | undefined): number {
  switch (format) {
    case 'date': return STYLE_DATE;
    case 'number': return STYLE_NUMBER;
    case 'currency': return STYLE_CURRENCY;
    case 'integer': return STYLE_INTEGER;
    case 'percent': return STYLE_PERCENT;
    default: return STYLE_DEFAULT;
  }
}

function defaultWidth(column: SheetColumn): number {
  if (column.width) return column.width;
  switch (column.format) {
    case 'date': return 13;
    case 'currency': return 15;
    case 'number': return 12;
    case 'integer': return 9;
    case 'percent': return 10;
    default: return Math.min(Math.max(column.header.length + 4, 12), 40);
  }
}

function cellXml(ref: string, value: CellValue, format: ColumnFormat | undefined): string {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${styleFor(format)}"/>`;
  }

  if (format === 'date') {
    const d = parseDate(value);
    if (d) return `<c r="${ref}" s="${STYLE_DATE}"><v>${excelSerial(d)}</v></c>`;
    return `<c r="${ref}" s="${STYLE_DEFAULT}" t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`;
  }

  if (format === 'number' || format === 'currency' || format === 'integer' || format === 'percent') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(n)) return `<c r="${ref}" s="${styleFor(format)}"><v>${n}</v></c>`;
    return `<c r="${ref}" s="${STYLE_DEFAULT}" t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${STYLE_DEFAULT}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" s="${STYLE_DEFAULT}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" s="${STYLE_DEFAULT}" t="inlineStr"><is><t>${esc(String(value))}</t></is></c>`;
}

function sheetXml(spec: SheetSpec): string {
  const rows: string[] = [];
  let r = 1;

  if (spec.title) {
    rows.push(
      `<row r="${r}" ht="21" customHeight="1">` +
      `<c r="A${r}" s="${STYLE_TITLE}" t="inlineStr"><is><t>${esc(spec.title)}</t></is></c></row>`);
    r += 1;
  }
  for (const line of spec.subtitles ?? []) {
    rows.push(
      `<row r="${r}">` +
      `<c r="A${r}" s="${STYLE_SUBTITLE}" t="inlineStr"><is><t>${esc(line)}</t></is></c></row>`);
    r += 1;
  }
  if (spec.title || (spec.subtitles?.length ?? 0) > 0) {
    rows.push(`<row r="${r}"/>`);
    r += 1;
  }

  const headerRow = r;
  rows.push(
    `<row r="${r}" ht="18" customHeight="1">` +
    spec.columns
      .map((c, i) =>
        `<c r="${columnLetter(i)}${r}" s="${STYLE_HEADER}" t="inlineStr">` +
        `<is><t>${esc(c.header)}</t></is></c>`)
      .join('') +
    '</row>');
  r += 1;

  const firstDataRow = r;
  for (const row of spec.rows) {
    rows.push(
      `<row r="${r}">` +
      spec.columns
        .map((c, i) => cellXml(`${columnLetter(i)}${r}`, row[c.field], c.format))
        .join('') +
      '</row>');
    r += 1;
  }
  const lastDataRow = r - 1;

  if (spec.totals && spec.totals.length > 0 && spec.rows.length > 0) {
    const cells = spec.columns.map((c, i) => {
      const ref = `${columnLetter(i)}${r}`;
      if (i === 0) {
        return `<c r="${ref}" s="${STYLE_TOTAL_LABEL}" t="inlineStr"><is><t>Total</t></is></c>`;
      }
      if (!spec.totals?.includes(c.field)) return `<c r="${ref}" s="${STYLE_TOTAL_LABEL}"/>`;
      const col = columnLetter(i);

      /*
       * A SUM FORMULA *AND* ITS ANSWER.
       *
       * The formula alone is what a spreadsheet wants — the total then moves
       * when somebody filters or edits a row. But a formula cell with no
       * cached <v> reads as EMPTY to anything that does not evaluate
       * formulas, which includes most import paths and every plain xlsx
       * reader. The first export opened with a "Total" label and blank
       * figures beside it.
       *
       * Writing both means Excel recalculates and everything else still sees
       * the number we computed here.
       */
      const sum = spec.rows.reduce((acc, row) => {
        const raw = row[c.field];
        const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(n) ? acc + n : acc;
      }, 0);
      const rounded = Math.round(sum * 100) / 100;

      return `<c r="${ref}" s="${STYLE_TOTAL_CURRENCY}">` +
             `<f>SUM(${col}${firstDataRow}:${col}${lastDataRow})</f>` +
             `<v>${rounded}</v></c>`;
    });
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  }

  const lastCol = columnLetter(Math.max(spec.columns.length - 1, 0));
  const cols = spec.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${defaultWidth(c)}" customWidth="1"/>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">
<pane ySplit="${headerRow}" topLeftCell="A${firstDataRow}" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rows.join('')}</sheetData>
${spec.rows.length > 0
    ? `<autoFilter ref="A${headerRow}:${lastCol}${lastDataRow}"/>`
    : ''}
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>
<numFmt numFmtId="165" formatCode="#,##0.00"/>
<numFmt numFmtId="166" formatCode="#,##0"/>
<numFmt numFmtId="167" formatCode="0.0%"/>
</numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1A1A1A"/><name val="Calibri"/></font>
<font><b/><sz val="15"/><color rgb="FF1A1A1A"/><name val="Calibri"/></font>
<font><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1A1A1A"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4F1EA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9CFA8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
</cellXfs>
</styleSheet>`;

// ── zip ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry { name: string; bytes: Uint8Array; crc: number; offset: number }

/** STORED-only zip. Valid everywhere; the payload here is a few kilobytes of XML. */
function zip(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const bytes = encoder.encode(file.content);
    const crc = crc32(bytes);

    const header = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),          // time, date — fixed, see below
      ...u32(crc), ...u32(bytes.length), ...u32(bytes.length),
      ...u16(nameBytes.length), ...u16(0),
    ]);

    chunks.push(header, nameBytes, bytes);
    entries.push({ name: file.name, bytes, crc, offset });
    offset += header.length + nameBytes.length + bytes.length;
  }

  const central: Uint8Array[] = [];
  let centralSize = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const record = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(entry.crc), ...u32(entry.bytes.length), ...u32(entry.bytes.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(entry.offset),
    ]);
    central.push(record, nameBytes);
    centralSize += record.length + nameBytes.length;
  }

  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  // The spread is typed as Uint8Array<ArrayBufferLike>, and BlobPart wants
  // ArrayBufferView<ArrayBuffer>. Every buffer here was allocated by us and
  // is a plain ArrayBuffer; SharedArrayBuffer cannot occur.
  const parts = [...chunks, ...central, end] as unknown as BlobPart[];
  return new Blob(parts, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ── the workbook ───────────────────────────────────────────────────────────

export function buildWorkbook(sheets: SheetSpec[]): Blob {
  const safeSheets = sheets.length > 0
    ? sheets
    : [{ name: 'Sheet1', columns: [], rows: [] } as SheetSpec];

  // Excel refuses a sheet name over 31 characters or containing : \ / ? * [ ]
  const names = safeSheets.map((s, i) => {
    const cleaned = (s.name || `Sheet${i + 1}`).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim();
    return cleaned || `Sheet${i + 1}`;
  });

  const files: Array<{ name: string; content: string }> = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${safeSheets.map((_, i) =>
  `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) =>
  `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${safeSheets.map((_, i) =>
  `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES },
    ...safeSheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: sheetXml(s),
    })),
  ];

  return zip(files);
}

/** A filename a person can find again: no slashes, no colons, dated. */
export function safeFileName(base: string, extension: string): string {
  const cleaned = base.replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'export';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${cleaned} ${stamp}.${extension}`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; a tick is
  // enough and the object is a few kilobytes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(columns: SheetColumn[], rows: Array<Record<string, CellValue>>): string {
  const cell = (value: CellValue): string => {
    if (value === null || value === undefined) return '';
    const date = parseDate(value);
    const text = date ? date.toISOString().slice(0, 10) : String(value);
    // A leading =, +, - or @ makes a spreadsheet treat a cell as a formula.
    // Prefixing an apostrophe is what stops an exported sales file from
    // executing something a customer typed into a notes field.
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n;]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  return [
    columns.map((c) => cell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => cell(row[c.field])).join(',')),
  ].join('\r\n');
}
