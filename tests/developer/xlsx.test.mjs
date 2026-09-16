// Does the spreadsheet we write actually open?
//
// This is not a snapshot test of our own XML. src/lib/xlsx.ts hand-builds an
// OOXML package and a STORED zip with no library, so the only test worth
// having is whether a real xlsx READER can open what it produced and get the
// values back. `read-excel-file` is already a dependency (the inventory
// import uses it), which makes it an independent second implementation —
// exactly what is needed here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import readXlsxFile from 'read-excel-file/node';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** Compile src/lib/xlsx.ts on the fly — no build step for one module. */
async function loadXlsxModule() {
  const source = await readFile(path.join(ROOT, 'src/lib/xlsx.ts'), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = await mkdtempish();
  const file = path.join(dir, 'xlsx.mjs');
  await writeFile(file, js, 'utf8');
  return { mod: await import(pathToFileURL(file).href), dir };
}

/**
 * This version of read-excel-file returns `[{ sheet, data }]` rather than a
 * bare row array. Normalising here rather than asserting on one shape keeps
 * the test about the FILE, which is what it is for.
 */
async function readRows(file) {
  const result = await readXlsxFile(file);
  if (Array.isArray(result) && result.length > 0 && Array.isArray(result[0].data)) {
    return result[0].data;
  }
  return result;
}

async function mkdtempish() {
  const dir = path.join(os.tmpdir(), `homatch-xlsx-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test('the workbook we write can be read back by an independent xlsx reader', async (t) => {
  const { mod, dir } = await loadXlsxModule();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const blob = mod.buildWorkbook([
    {
      name: 'Sales',
      title: 'Villion Tower — sales',
      subtitles: ['Project: Villion Tower', 'Generated: 2026-09-15'],
      columns: [
        { header: 'Unit', field: 'unit', format: 'text' },
        { header: 'Buyer', field: 'buyer', format: 'text' },
        { header: 'Area', field: 'area', format: 'number' },
        { header: 'Sale price', field: 'price', format: 'currency' },
        { header: 'Contract date', field: 'date', format: 'date' },
        { header: 'Rooms', field: 'rooms', format: 'integer' },
      ],
      rows: [
        { unit: 'A-704', buyer: 'Giorgi', area: 97.2, price: 152000, date: '2026-09-15', rooms: 3 },
        { unit: 'A-801', buyer: 'Anna & Co', area: 128, price: 221000, date: '2026-08-01', rooms: 4 },
        // A name with characters that must survive XML escaping.
        { unit: 'B-101', buyer: 'Smith <&> "Quote"', area: 55.5, price: 90000, date: null, rooms: 2 },
      ],
      totals: ['price'],
    },
  ]);

  const file = path.join(dir, 'out.xlsx');
  await writeFile(file, Buffer.from(await blob.arrayBuffer()));

  const rows = await readRows(file);

  // Title, subtitles, a blank line, then the header.
  assert.equal(rows[0][0], 'Villion Tower — sales');
  assert.equal(rows[1][0], 'Project: Villion Tower');

  const headerIndex = rows.findIndex((r) => r[0] === 'Unit');
  assert.ok(headerIndex > 0, 'header row present');
  assert.deepEqual(
    rows[headerIndex].slice(0, 6),
    ['Unit', 'Buyer', 'Area', 'Sale price', 'Contract date', 'Rooms'],
  );

  const first = rows[headerIndex + 1];
  assert.equal(first[0], 'A-704');
  assert.equal(first[1], 'Giorgi');
  assert.equal(first[2], 97.2);
  assert.equal(first[3], 152000);
  // Dates must come back as dates, not as the text a CSV would have produced.
  assert.ok(first[4] instanceof Date, 'contract date round-trips as a Date');
  assert.equal(first[4].toISOString().slice(0, 10), '2026-09-15');
  assert.equal(first[5], 3);

  const third = rows[headerIndex + 3];
  assert.equal(third[1], 'Smith <&> "Quote"', 'XML-significant characters survive');
  assert.equal(third[4], null, 'an empty date stays empty rather than becoming 1899-12-30');
});

test('a workbook with no rows is still a valid file', async (t) => {
  const { mod, dir } = await loadXlsxModule();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const blob = mod.buildWorkbook([
    { name: 'Empty', columns: [{ header: 'Unit', field: 'unit' }], rows: [] },
  ]);
  const file = path.join(dir, 'empty.xlsx');
  await writeFile(file, Buffer.from(await blob.arrayBuffer()));

  const rows = await readRows(file);
  assert.equal(rows[0][0], 'Unit');
  assert.equal(rows.length, 1);
});

test('sheet names are trimmed to what Excel accepts', async (t) => {
  const { mod, dir } = await loadXlsxModule();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const blob = mod.buildWorkbook([
    {
      name: 'a/very:long[name]that*excel?would\\refuse and is far too many characters',
      columns: [{ header: 'X', field: 'x' }],
      rows: [{ x: 1 }],
    },
  ]);
  const file = path.join(dir, 'name.xlsx');
  await writeFile(file, Buffer.from(await blob.arrayBuffer()));
  const rows = await readRows(file);
  assert.equal(rows[0][0], 'X');
});

test('csv export neutralises a cell that would run as a formula', async () => {
  const { mod } = await loadXlsxModule();
  const csv = mod.toCsv(
    [{ header: 'Note', field: 'note' }],
    [{ note: '=SUM(A1:A9)' }, { note: '+1234' }, { note: 'plain' }],
  );
  const lines = csv.split('\r\n');
  assert.equal(lines[1], "'=SUM(A1:A9)");
  assert.equal(lines[2], "'+1234");
  assert.equal(lines[3], 'plain');
});

test('excel serial dates match the 1899-12-30 epoch', async () => {
  const { mod } = await loadXlsxModule();
  // 1 January 1900 is serial 1 in Excel's scheme.
  assert.equal(mod.excelSerial(new Date(1900, 0, 1)), 2);
  assert.equal(mod.excelSerial(new Date(2026, 8, 15)), 46280);
});

test('column letters carry past Z', async () => {
  const { mod } = await loadXlsxModule();
  assert.equal(mod.columnLetter(0), 'A');
  assert.equal(mod.columnLetter(25), 'Z');
  assert.equal(mod.columnLetter(26), 'AA');
  assert.equal(mod.columnLetter(51), 'AZ');
  assert.equal(mod.columnLetter(52), 'BA');
});

test('a totals row carries the number, not only the formula', async (t) => {
  const { mod, dir } = await loadXlsxModule();
  t.after(() => rm(dir, { recursive: true, force: true }));

  // A formula cell with no cached <v> reads as empty to anything that does
  // not evaluate formulas — which is most xlsx readers and every plain
  // import path. The exported sales file showed "Total" beside blank cells
  // until the writer started emitting both.
  const blob = mod.buildWorkbook([
    {
      name: 'Totals',
      columns: [
        { header: 'Unit', field: 'unit', format: 'text' },
        { header: 'Sale price', field: 'price', format: 'currency' },
        { header: 'Paid', field: 'paid', format: 'currency' },
      ],
      rows: [
        { unit: 'A-1', price: 152000, paid: 45600 },
        { unit: 'A-2', price: 100000.5, paid: 0 },
      ],
      totals: ['price', 'paid'],
    },
  ]);

  const file = path.join(dir, 'totals.xlsx');
  await writeFile(file, Buffer.from(await blob.arrayBuffer()));
  const rows = await readRows(file);

  const totalRow = rows.find((r) => r[0] === 'Total');
  assert.ok(totalRow, 'a totals row is present');
  assert.equal(totalRow[1], 252000.5, 'sale price total is readable without evaluating the formula');
  assert.equal(totalRow[2], 45600, 'paid total is readable without evaluating the formula');
});
