// Phone parsing and contact import — the two places a bad answer costs money.
//
// A number that parses wrongly is a call that does not connect, or worse, a
// call that connects to a stranger. A duplicate that is not recognised is the
// same person dialled twice. A suppressed number that an import re-enables is
// a person who asked us to stop and got another call anyway.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePhone, cleanPhoneInput, normalizeCountryCode, phoneDedupeKey, maskPhone,
} from '../phone.ts';
import {
  detectHeader, detectColumns, detectFromSample, normalizeHeader, applyMapping,
} from '../headerDetect.ts';
import { parseCsv, sniffFormat, detectFormat, prepareRows, sampleCsv } from '../importFile.ts';

// ── Phone ───────────────────────────────────────────────────────────────────

test('an explicit international prefix is trusted over the import default', () => {
  // §14: "If numbers contain explicit international prefixes: trust parsed
  // country." Silently re-homing a UK number to Georgia because the sheet was
  // mostly Georgian is how a campaign dials the wrong continent.
  const uk = parsePhone('+44 20 7946 0958', 'GE');
  assert.equal(uk.country, 'GB');
  assert.equal(uk.confidence, 'HIGH');
  assert.equal(uk.countryInferred, false);
});

test('a Georgian mobile in local form resolves with the default country', () => {
  const parsed = parsePhone('599 12 34 56', 'GE');
  assert.equal(parsed.e164, '+995599123456');
  assert.equal(parsed.country, 'GE');
  assert.equal(parsed.valid, true);
  // MEDIUM, not HIGH: the country came from the import, not the number.
  assert.equal(parsed.confidence, 'MEDIUM');
  assert.equal(parsed.countryInferred, true);
});

test('a local number with no country to read it against is refused, not guessed', () => {
  const parsed = parsePhone('599123456', null);
  assert.equal(parsed.e164, null);
  assert.equal(parsed.reason, 'NO_COUNTRY');
  assert.equal(parsed.confidence, 'UNRESOLVED');
});

test('a number that is not real for its country is kept for review but never marked valid', () => {
  const parsed = parsePhone('+995 1', 'GE');
  assert.equal(parsed.valid, false);
});

test('00 is the same as +', () => {
  assert.equal(parsePhone('00995599123456').e164, '+995599123456');
});

test('spreadsheet and human decorations are stripped', () => {
  assert.equal(cleanPhoneInput('+995 (599) 12-34-56'), '+995599123456');
  assert.equal(cleanPhoneInput('+995599123456 ext. 22'), '+995599123456');
  // Eastern Arabic digits: Arabic is a first-class locale (§82) and a pasted
  // number arrives in these code points.
  assert.equal(cleanPhoneInput('+٩٩٥٥٩٩١٢٣٤٥٦'), '+995599123456');
});

test('country names resolve from any of the six locales', () => {
  assert.equal(normalizeCountryCode('საქართველო'), 'GE');
  assert.equal(normalizeCountryCode('Россия'), 'RU');
  assert.equal(normalizeCountryCode('Türkiye'), 'TR');
  assert.equal(normalizeCountryCode('ge'), 'GE');
  assert.equal(normalizeCountryCode('+995'), 'GE');
  assert.equal(normalizeCountryCode('Atlantis'), null);
});

test('the dedupe key is the whole E.164 and nothing cleverer', () => {
  // Matching on a suffix would collapse two genuinely different numbers in two
  // countries, and a duplicate that eats a real contact is worse than one that
  // survives.
  const ge = parsePhone('+995599123456');
  const ru = parsePhone('+7 999 123 45 67');
  assert.notEqual(phoneDedupeKey(ge), phoneDedupeKey(ru));
  assert.equal(phoneDedupeKey(parsePhone('+995 599 123456')), phoneDedupeKey(ge));
});

test('masking keeps enough to correlate and not enough to identify', () => {
  const masked = maskPhone('+995599123456');
  assert.ok(masked.startsWith('+995'));
  assert.ok(masked.endsWith('56'));
  assert.ok(!masked.includes('599123'));
});

// ── Header detection ────────────────────────────────────────────────────────

test('phone headers are recognised in every locale the product supports', () => {
  for (const header of ['Phone', 'phone_number', 'მობილური', 'ტელეფონი', 'Телефон', 'Cep Telefonu', 'هاتف', 'טלפון']) {
    assert.equal(detectHeader(header).field, 'phone', `failed on ${header}`);
  }
});

test('Georgian first name and surname are told apart', () => {
  assert.equal(detectHeader('სახელი').field, 'first_name');
  assert.equal(detectHeader('გვარი').field, 'last_name');
});

test('"Company name" is a company, not a person', () => {
  // The trap: a contains-match on "name" would make this a full_name.
  assert.equal(detectHeader('Company name').field, 'company');
});

test('separators and case do not matter', () => {
  assert.equal(normalizeHeader('First Name'), normalizeHeader('first_name'));
  assert.equal(normalizeHeader('FIRST-NAME'), normalizeHeader('firstname'));
});

test('a column is identified by its data when its header means nothing', () => {
  const phones = ['+995599123456', '+995577000111', '+995555222333', '+995598111222'];
  assert.equal(detectFromSample(phones), 'phone');
  assert.equal(detectFromSample(['a@b.com', 'c@d.org', 'e@f.net', 'g@h.io']), 'email');
  // Dates and prices are not phone numbers.
  assert.equal(detectFromSample(['01/02/2024', '03/04/2024', '05/06/2024', '07/08/2024']), null);
  assert.equal(detectFromSample(['$180000', '$210000', '$95000', '$310000']), null);
});

test('a field is claimed once, so two phone columns do not overwrite each other', () => {
  const result = detectColumns(['Phone', 'Phone 2', 'Name']);
  const phoneColumns = result.columns.filter((c) => c.field === 'phone');
  assert.equal(phoneColumns.length, 1);
});

test('a missing phone column is reported rather than assumed', () => {
  assert.equal(detectColumns(['Name', 'Email']).missingPhone, true);
  assert.equal(detectColumns(['Name', 'მობილური']).missingPhone, false);
});

test('a header row that is really data is flagged', () => {
  const result = detectColumns(['+995599123456', 'Nino', 'nino@example.com'], []);
  assert.equal(result.headerRowLooksLikeData, true);
});

test('a full name splits on the LAST space, so a two-part first name survives', () => {
  const columns = detectColumns(['Full name']).columns;
  assert.deepEqual(
    applyMapping(['Anna Maria Rossi'], columns),
    { full_name: 'Anna Maria Rossi', last_name: 'Rossi', first_name: 'Anna Maria' },
  );
});

// ── CSV ─────────────────────────────────────────────────────────────────────

test('quoted fields, embedded commas and doubled quotes survive', () => {
  const { headers, rows } = parseCsv('name,note\n"Beridze, Nino","said ""maybe"" twice"\n');
  assert.deepEqual(headers, ['name', 'note']);
  assert.deepEqual(rows[0], ['Beridze, Nino', 'said "maybe" twice']);
});

test('semicolon exports and a UTF-8 BOM are handled', () => {
  const { headers, rows } = parseCsv('﻿phone;name\n+995599123456;Nino\n');
  assert.deepEqual(headers, ['phone', 'name']);
  assert.deepEqual(rows[0], ['+995599123456', 'Nino']);
});

test('a legacy .xls is recognised by its bytes, not its extension', () => {
  const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(sniffFormat(ole2), 'XLS_UNSUPPORTED');
  // A .xls renamed to .xlsx is the common case and must not reach the ZIP reader.
  assert.equal(detectFormat({ name: 'contacts.xlsx' }), 'XLSX');
  assert.equal(sniffFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), 'XLSX');
});

// ── Row preparation ─────────────────────────────────────────────────────────

const COLUMNS = detectColumns(['phone', 'first_name', 'last_name', 'email']).columns;

test('duplicates inside one file are counted once and marked', () => {
  const { prepared, summary } = prepareRows(
    [
      ['+995599123456', 'Nino', 'Beridze', 'a@example.com'],
      ['+995 599 123456', 'Nino', 'Beridze', 'a@example.com'],
    ],
    COLUMNS,
    { defaultCountry: 'GE' },
  );
  assert.equal(summary.valid, 1);
  assert.equal(summary.duplicates, 1);
  assert.equal(prepared[1].status, 'DUPLICATE');
  assert.equal(prepared[1].reason, 'DUPLICATE_IN_FILE');
});

test('a number already on the account is recognised as already imported', () => {
  const { summary, prepared } = prepareRows(
    [['+995599123456', 'Nino', 'Beridze', '']],
    COLUMNS,
    { defaultCountry: 'GE', existingPhones: new Set(['+995599123456']) },
  );
  assert.equal(summary.duplicates, 1);
  assert.equal(prepared[0].reason, 'ALREADY_IMPORTED');
});

test('AN IMPORT CAN NEVER RE-ENABLE SOMEONE WHO OPTED OUT', () => {
  // §14 step 5, and the single most important rule in this file. The most
  // common way a platform contacts someone who asked it to stop is by
  // re-importing a list they were once on.
  const { prepared, summary } = prepareRows(
    [['+995599123456', 'Nino', 'Beridze', '']],
    COLUMNS,
    { defaultCountry: 'GE', suppressedPhones: new Set(['+995599123456']) },
  );
  assert.equal(prepared[0].status, 'SUPPRESSED');
  assert.equal(prepared[0].reason, 'PREVIOUSLY_OPTED_OUT');
  assert.equal(summary.valid, 0);
  assert.equal(summary.suppressed, 1);
});

test('suppression outranks duplication, so an opted-out repeat is never merely a duplicate', () => {
  const { prepared } = prepareRows(
    [['+995599123456', '', '', ''], ['+995599123456', '', '', '']],
    COLUMNS,
    { defaultCountry: 'GE', suppressedPhones: new Set(['+995599123456']) },
  );
  assert.equal(prepared[0].status, 'SUPPRESSED');
  assert.equal(prepared[1].status, 'SUPPRESSED');
});

test('rows with no usable number are counted as invalid rather than imported', () => {
  const { summary } = prepareRows(
    [['not a number', 'A', 'B', ''], ['', 'C', 'D', ''], ['+995599123456', 'E', 'F', '']],
    COLUMNS,
    { defaultCountry: 'GE' },
  );
  assert.equal(summary.valid, 1);
  assert.equal(summary.invalid, 2);
});

test('the sample file Homatch offers actually imports cleanly', () => {
  // §109. A sample that fails its own importer is worse than no sample.
  const { headers, rows } = parseCsv(sampleCsv());
  const detection = detectColumns(headers, rows);
  assert.equal(detection.missingPhone, false);
  const { summary } = prepareRows(rows, detection.columns, { defaultCountry: 'GE' });
  assert.equal(summary.valid, rows.length);
  assert.equal(summary.invalid, 0);
});
