// Contact import, end to end through the real parsers.
//
// The previous release verified import by reading the code. This runs a real
// .csv and a real .xlsx — bytes, not mocks — through the same functions the
// product calls, and asserts on the three outcomes that decide whether an
// import can be trusted:
//
//   the clean number is imported
//   the same person written three ways collapses to ONE contact
//   something that is not a phone number is refused rather than dialled
//
// The duplicate case is the one worth being loud about. +995 555 01 02 03,
// 00995555010203 and 995555010203 are one human being. Importing them as
// three contacts means calling that person three times, which is the exact
// complaint that gets a sender blocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseXlsx, prepareRows, detectFormat, sniffFormat } from '../importFile.ts';
import { detectColumns } from '../headerDetect.ts';
import { makeXlsx, IMPORT_FIXTURE_ROWS, IMPORT_FIXTURE_CSV } from './fixtures/makeXlsx.mjs';

const GE = 'GE';

function analyse(headers, rows) {
  const detection = detectColumns(headers, rows);
  const prep = prepareRows(rows, detection.columns, { defaultCountry: GE });
  return { columns: detection.columns, detection, prep };
}

test('CSV: headers are detected without being told what they are', () => {
  const { headers, rows } = parseCsv(IMPORT_FIXTURE_CSV);
  assert.equal(headers.length, 5);
  assert.equal(rows.length, 5);

  const { columns } = analyse(headers, rows);
  const mapped = Object.fromEntries(columns.filter((c) => c.field).map((c) => [c.field, c.header]));
  assert.equal(mapped.phone, 'Phone');
  assert.equal(mapped.full_name, 'Full name');
  assert.equal(mapped.email, 'Email');
});

test('CSV: three spellings of one number become one importable contact', () => {
  const { headers, rows } = parseCsv(IMPORT_FIXTURE_CSV);
  const { prep } = analyse(headers, rows);

  const importable = prep.prepared.filter((r) => r.status === 'VALID');
  const duplicates = prep.prepared.filter((r) => r.status === 'DUPLICATE');
  const invalid = prep.prepared.filter((r) => r.status === 'INVALID');

  // Nino once, Giorgi once.
  assert.equal(importable.length, 2, 'exactly two distinct people are importable');
  // The other two spellings of Nino.
  assert.equal(duplicates.length, 2, 'both alternative spellings are recognised as the same person');
  assert.equal(invalid.length, 1, '"not a phone" must not be importable');

  // And the surviving number is the canonical one.
  const numbers = importable.map((r) => r.phone.e164).sort();
  assert.deepEqual(numbers, ['+995555010203', '+995555090807']);
});

test('CSV: the counts reported to the customer are the real ones', () => {
  const { headers, rows } = parseCsv(IMPORT_FIXTURE_CSV);
  const { prep } = analyse(headers, rows);

  // Imported + duplicates + invalid must account for every row read. A summary
  // that loses a row is a summary that hides a failure.
  const total = prep.prepared.length;
  const valid = prep.prepared.filter((r) => r.status === 'VALID').length;
  const dup = prep.prepared.filter((r) => r.status === 'DUPLICATE').length;
  const bad = prep.prepared.filter((r) => r.status === 'INVALID').length;
  assert.equal(valid + dup + bad, total);
  assert.equal(total, 5);
});

test('XLSX: a real workbook parses, and a phone column survives as text', async () => {
  const bytes = makeXlsx(IMPORT_FIXTURE_ROWS);

  // It must look like an xlsx to the sniffer before anything else happens: a
  // .xls renamed to .xlsx is the common case and has to be caught here.
  assert.equal(sniffFormat(bytes.slice(0, 8)), 'XLSX');
  assert.equal(detectFormat({ name: 'contacts.xlsx' }), 'XLSX');

  // parseXlsx is THE product function — not the library underneath it. The
  // whole defect this test exists for lived in parseXlsx's handling of what
  // the library returns, so testing the library would have proved nothing.
  const file = new File([bytes], 'contacts.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const { headers, rows } = await parseXlsx(file);

  assert.deepEqual(headers, ['Full name', 'Phone', 'Email', 'Language', 'Country']);

  // The point of inline strings: the plus survives and there is no
  // exponential notation. A phone read as a number is a phone that cannot be
  // dialled.
  const phones = rows.map((r) => r[1]);
  assert.ok(phones.includes('+995 555 01 02 03'), `phone column was mangled: ${JSON.stringify(phones)}`);
  assert.ok(!phones.some((p) => /e\+/i.test(p)), 'a phone came back in exponential notation');
});

test('XLSX: the same rows reach the same verdicts as the CSV', async () => {
  const bytes = makeXlsx(IMPORT_FIXTURE_ROWS);
  // parseXlsx is THE product function — not the library underneath it. The
  // whole defect this test exists for lived in parseXlsx's handling of what
  // the library returns, so testing the library would have proved nothing.
  const file = new File([bytes], 'contacts.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const { headers, rows } = await parseXlsx(file);

  const { prep } = analyse(headers, rows);
  assert.equal(prep.prepared.filter((r) => r.status === 'VALID').length, 2);
  assert.equal(prep.prepared.filter((r) => r.status === 'DUPLICATE').length, 2);
  assert.equal(prep.prepared.filter((r) => r.status === 'INVALID').length, 1);
});

test('legacy .xls stays refused, and says so rather than being mis-parsed', () => {
  // The decision documented in importFile.ts: the only maintained pure-JS
  // reader for BIFF ships with unfixed advisories, and this path parses files
  // from strangers. It must be REFUSED, never silently half-read.
  assert.equal(detectFormat({ name: 'contacts.xls' }), 'XLS_UNSUPPORTED');

  // Its magic bytes too, so a rename cannot smuggle one past the extension.
  const oleHeader = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(sniffFormat(oleHeader), 'XLS_UNSUPPORTED');
});
