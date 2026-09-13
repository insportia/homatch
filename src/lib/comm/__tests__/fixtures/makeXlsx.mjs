// A real .xlsx, built by hand, for tests.
//
// WHY NOT A CHECKED-IN BINARY
//
// A committed .xlsx is opaque: nobody can see what is in it from a diff, and
// when a test starts failing there is no way to tell whether the fixture or
// the parser changed. This produces the bytes from a table you can read in the
// source, so a fixture change is a visible change.
//
// WHY NOT A LIBRARY
//
// Nothing in this repository writes spreadsheets in production, and adding a
// dependency so a test can build four rows is the wrong trade. An xlsx is a
// ZIP of XML; the minimum a reader needs is five small files, and STORE
// (uncompressed) entries make the container about forty lines.
//
// The output is read back by the SAME parser the product uses
// (read-excel-file), so if this file drifted out of spec the test would fail
// rather than quietly testing a shape nothing else produces.

import { crc32 } from 'node:zlib';

const enc = new TextEncoder();

/** Column index (0-based) to a spreadsheet column name: 0 -> A, 26 -> AA. */
function columnName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * Every cell is written as an inline string.
 *
 * That is what makes this small: with inlineStr there is no sharedStrings
 * table to build or keep consistent. It also matches the case the product
 * cares about — a phone column must arrive as TEXT, because the moment a
 * spreadsheet treats +995555010203 as a number the plus is gone and the
 * digits come back in exponential notation.
 */
function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      if (value === null || value === undefined || value === '') return '';
      return `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${body}</sheetData></worksheet>`;
}

const FILES = (rows) => ([
  ['[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    + `</Types>`],
  ['_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`],
  ['xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets><sheet name="Contacts" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
    + `</Relationships>`],
  ['xl/worksheets/sheet1.xml', sheetXml(rows)],
]);

/* ── The ZIP container ──────────────────────────────────────────────────────
 * STORE only. Compression would save a few hundred bytes on a fixture and add
 * a deflate stream nobody can inspect when something goes wrong.
 */
function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function u32(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]; }

export function makeXlsx(rows) {
  const entries = FILES(rows).map(([name, xml]) => ({
    name: enc.encode(name),
    data: enc.encode(xml),
  }));

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const crc = crc32(entry.data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),                     // time, date: fixed, so the
      ...u32(crc),                              // fixture is byte-identical
      ...u32(entry.data.length),                // every run
      ...u32(entry.data.length),
      ...u16(entry.name.length), ...u16(0),
    ];
    chunks.push(Uint8Array.from(local), entry.name, entry.data);

    central.push(Uint8Array.from([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(entry.data.length), ...u32(entry.data.length),
      ...u16(entry.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
    ]), entry.name);

    offset += local.length + entry.name.length + entry.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * The table every import test uses.
 *
 * Each row is here for a reason, and the reasons are the acceptance criteria:
 * one clean number; the SAME person written three ways, which must collapse to
 * one; and something that is not a phone number at all, which must be refused
 * rather than dialled.
 */
export const IMPORT_FIXTURE_ROWS = [
  ['Full name', 'Phone', 'Email', 'Language', 'Country'],
  ['Nino Beridze', '+995 555 01 02 03', 'nino@example.com', 'ka', 'GE'],
  ['Nino Beridze (dup)', '00995555010203', '', 'ka', 'GE'],
  ['Nino Beridze (dup2)', '995555010203', '', 'ka', 'GE'],
  ['Giorgi Kapanadze', '+995 555 09 08 07', 'giorgi@example.com', 'ka', 'GE'],
  ['Broken Row', 'not a phone', 'x@example.com', 'en', 'GE'],
];

export const IMPORT_FIXTURE_CSV = IMPORT_FIXTURE_ROWS
  .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
  .join('\n');
