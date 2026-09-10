// What a document-history row is allowed to say.
//
// Every fixture below is a VERBATIM value from the stored report for a real
// production job, not an invented one. That matters: the fix changed shape
// once I read the actual payload and found that the extractor's VALUES are
// often fragments of the PDF form rather than values ("height" was "(მ):"),
// which a whitelist of keys alone would happily have shipped.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  factLabelKey,
  isPresentableValue,
  presentableFacts,
  readableDocumentDate,
  documentKind,
  documentRef,
  buildDocumentRows,
  summarizeDocumentHistory,
} from '../documentPresentation.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

/* ── the extractor's own vocabulary never reaches a customer ─────────── */

test('an internal field name renders nothing rather than itself', () => {
  // These are the exact keys that were on screen.
  for (const k of ['K2', 'piles', 'structuralScheme', 'geologicalSurvey', 'coAuthors', 'idCode', 'parcelOwner']) {
    assert.equal(factLabelKey(k), null, `${k} is still shown to a customer`);
  }
});

test('a buyer-relevant field resolves to a translation key, never raw prose', () => {
  assert.equal(factLabelKey('buildingFunction'), 'verify_docfact_building_function');
  assert.equal(factLabelKey('buildingBlock'), 'verify_docfact_block');
  // Case and padding come from the extractor, not from a human.
  assert.equal(factLabelKey('  BUILDINGFUNCTION  '), 'verify_docfact_building_function');
});

test('elevator is deliberately absent, because its failure mode is invisible', () => {
  // In production `elevator` carried "განსაზღვრეთ განაცხადის მდებარეობა
  // რუკაზე" — a well-formed sentence about the application form's map, which
  // no syntactic value check can catch. A key stays out of the whitelist
  // unless the value gate can protect it.
  assert.equal(factLabelKey('elevator'), null);
  assert.ok(
    isPresentableValue('განსაზღვრეთ განაცხადის მდებარეობა რუკაზე'),
    'this fixture is only meaningful while the value gate cannot catch it'
  );
});

/* ── a value must be a value ─────────────────────────────────────────── */

test('a captured form label is not shown as a value', () => {
  for (const v of [
    '(მ):',
    'კოეფიციენტის საანგარიშო ფართობი (კვ.მ):',
    '(ებ)ის სახელი და გვარი.:',
    '.დამკვეთის ინფორმაცია. *',
    '/ საექსპერტო შეფასება',
    'ს წარმოადგენს შპს „ქეი-ელ-გრუპი“ (ს/ნ:',
  ]) {
    assert.equal(isPresentableValue(v), false, `"${v}" would be rendered as a fact`);
  }
});

test('a bare field-label noun standing as a value is rejected', () => {
  // Production had buildingFunction = "ფართობი" ("area") — the name of a
  // different field on the same form. It would have read "Permitted use: Area".
  assert.equal(isPresentableValue('ფართობი'), false);
  assert.deepEqual(presentableFacts([{ key: 'buildingFunction', value: 'ფართობი' }]), []);
});

test('the rule is a whole-string match, so a real value is not caught by it', () => {
  // "არასასოფლო სამეურნეო" is the genuine permitted-use value and must
  // survive; a substring rule against label nouns would have eaten values
  // like "საერთო ფართობი 797 კვ.მ".
  assert.equal(isPresentableValue('არასასოფლო სამეურნეო'), true);
  assert.equal(isPresentableValue('საერთო ფართობი 797 კვ.მ'), true);
});

test('a block is stated once, not twice', () => {
  // The entry field and the buildingBlock fact carry the same string in
  // production; saying it twice reads as padding.
  const [row] = buildDocumentRows([
    {
      documentTitle: 'AR11148112 17/06/2026',
      block: '2, ბინა 34',
      facts: [{ key: 'buildingBlock', value: '2, ბინა 34' }],
    },
  ]);
  assert.equal(row.block, null, 'the block is repeated outside the labelled fact');
  assert.deepEqual(row.facts, [{ labelKey: 'verify_docfact_block', value: '2, ბინა 34' }]);
});

test('a block that differs from the fact is still shown', () => {
  const [row] = buildDocumentRows([
    { documentTitle: 'AR11101896 29/07/2025', block: '2, ბინა 34', facts: [] },
  ]);
  assert.equal(row.block, '2, ბინა 34');
});

test('a real extracted value survives', () => {
  for (const v of ['არასასოფლო', 'არასასოფლო სამეურნეო', '2, ბინა 34', '797.05 კვ.მ.']) {
    assert.equal(isPresentableValue(v), true, `"${v}" was dropped`);
  }
});

test('an empty, absent or punctuation-only value is not a fact', () => {
  for (const v of ['', '   ', '—', ':', undefined, null, 42, {}]) {
    assert.equal(isPresentableValue(v), false);
  }
});

test('presentableFacts drops the unusable and dedupes the rest', () => {
  const facts = [
    { category: 'PROJECT', key: 'buildingFunction', value: 'არასასოფლო' },
    { category: 'PROJECT', key: 'buildingFunction', value: 'არასასოფლო' },
    { category: 'PROJECT', key: 'height', value: '(მ):' },
    { category: 'PERMIT', key: 'K2', value: 'კოეფიციენტის საანგარიშო ფართობი (კვ.მ):' },
    { category: 'APPLICANT', key: 'applicant', value: 'გიორგი ლეჟავა' },
  ];
  const out = presentableFacts(facts);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { labelKey: 'verify_docfact_building_function', value: 'არასასოფლო' });
});

/* ── dates ───────────────────────────────────────────────────────────── */

test('a PDF metadata timestamp becomes a calendar date', () => {
  assert.equal(readableDocumentDate("D:20240823122736+00'00'"), '2024-08-23');
  assert.equal(readableDocumentDate("D:20250714081926+00'00'"), '2025-07-14');
});

test('a date carried in the document title is recovered', () => {
  // The metadata date is null for these; the title is the only source.
  assert.equal(readableDocumentDate('AR11026464 28/03/2024'), '2024-03-28');
  assert.equal(readableDocumentDate('AR1990786 20/09/2023'), '2023-09-20');
});

test('an unreadable date becomes nothing, never a raw fragment', () => {
  for (const v of ['AR11148112 შედეგის ნახვა 1', 'NAPR registration 892024224686', '', null, 'D:garbage']) {
    assert.equal(readableDocumentDate(v), null, `"${v}" leaked through as a date`);
  }
});

test('an impossible date is rejected rather than displayed', () => {
  assert.equal(readableDocumentDate('D:20241399000000'), null);
  assert.equal(readableDocumentDate('AR1 45/13/2024'), null);
});

/* ── document identity ───────────────────────────────────────────────── */

test('a document is described by kind, never by its identifier', () => {
  assert.equal(documentKind('AR11026464 28/03/2024'), 'PERMIT_DOCUMENT');
  assert.equal(documentKind('AR11148112 შედეგის ნახვა 1'), 'PERMIT_DOCUMENT');
  assert.equal(documentKind('NAPR registration 892024224686'), 'REGISTRY_RECORD');
  assert.equal(documentKind('something else'), 'DOCUMENT');
});

test('the two rows emitted for one permit share a reference', () => {
  assert.equal(documentRef('AR11026464 28/03/2024'), documentRef('AR11026464 შედეგის ნახვა 1'));
  assert.notEqual(documentRef('AR11026464 28/03/2024'), documentRef('AR11031305 22/04/2024'));
  assert.equal(documentRef('not a document'), null);
});

/* ── the timeline as a whole ─────────────────────────────────────────── */

test('the production timeline collapses to dated, human rows', () => {
  // The real shape: one permit split across two entries, one carrying the
  // date and the other the facts, plus a registry record whose only date is
  // PDF metadata.
  const rows = buildDocumentRows([
    { documentTitle: 'AR11026464 შედეგის ნახვა 1', documentDate: null, facts: [{ key: 'buildingFunction', value: 'არასასოფლო' }] },
    { documentTitle: 'AR11026464 28/03/2024', documentDate: null, facts: [{ key: 'piles', value: 'ს მოწყობა' }] },
    { documentTitle: 'NAPR registration 892024224686', documentDate: "D:20240823122736+00'00'", facts: [] },
  ]);

  assert.equal(rows.length, 2, 'the permit did not collapse into one row');

  const permit = rows.find((r) => r.kindKey === 'verify_doc_kind_permit');
  assert.equal(permit.date, '2024-03-28', 'the date from the sibling entry was lost');
  assert.deepEqual(permit.facts, [{ labelKey: 'verify_docfact_building_function', value: 'არასასოფლო' }]);

  const registry = rows.find((r) => r.kindKey === 'verify_doc_kind_registry');
  assert.equal(registry.date, '2024-08-23');
});

test('a row that is only an identifier is not rendered at all', () => {
  // No date, and every fact an extractor internal — this says nothing to a
  // buyer and must not pose as evidence of thoroughness.
  const rows = buildDocumentRows([
    { documentTitle: 'AR11148112 შედეგის ნახვა 1', documentDate: null, facts: [{ key: 'structuralScheme', value: '/ საექსპერტო შეფასება' }] },
  ]);
  assert.deepEqual(rows, []);
});

test('rows are ordered oldest first', () => {
  const rows = buildDocumentRows([
    { documentTitle: 'AR11101896 29/07/2025', facts: [] },
    { documentTitle: 'AR1990786 20/09/2023', facts: [] },
    { documentTitle: 'AR11026464 28/03/2024', facts: [] },
  ]);
  assert.deepEqual(rows.map((r) => r.date), ['2023-09-20', '2024-03-28', '2025-07-29']);
});

test('a missing or malformed timeline yields nothing, never a throw', () => {
  for (const v of [null, undefined, [], 'nope', {}, [null, 3, 'x']]) {
    assert.deepEqual(buildDocumentRows(v), []);
  }
});

/* ── document history is counted, not diffed ─────────────────────────── */

test('history is summarized from structure, and reports what changed', () => {
  const s = summarizeDocumentHistory({
    available: true,
    documentsConsidered: 8,
    comparisons: [
      { changed: true, olderDocument: { date: '2009-12-07' }, newerDocument: { date: '2011-01-13' } },
      { changed: true, olderDocument: { date: '2011-01-13' }, newerDocument: { date: '2013-03-15' } },
      { changed: false, olderDocument: { date: '2013-03-15' }, newerDocument: { date: '2016-03-07' } },
    ],
  });
  assert.equal(s.documentsCompared, 8);
  assert.equal(s.changedCount, 2);
  assert.equal(s.firstDate, '2009-12-07');
  assert.equal(s.lastDate, '2016-03-07');
});

test('an unavailable or empty history renders nothing', () => {
  assert.equal(summarizeDocumentHistory({ available: false, comparisons: [{ changed: true }] }), null);
  assert.equal(summarizeDocumentHistory({ available: true, comparisons: [] }), null);
  assert.equal(summarizeDocumentHistory(null), null);
});

/* ── the rules this file exists to enforce ───────────────────────────── */

test('the raw registry diff is never rendered', () => {
  // Those lines are OCR'd text in a legacy Georgian encoding read as Latin-1.
  // They carried a previous owner's name, DATE OF BIRTH and personal number
  // to the customer as mojibake.
  const page = code('src/pages/VerifyPage.tsx');
  assert.ok(!/addedInNewer/.test(page), 'VerifyPage renders addedInNewer again');
  assert.ok(!/removedFromOlder/.test(page), 'VerifyPage renders removedFromOlder again');

  const module = code('src/verify/documentPresentation.ts');
  assert.ok(!/addedInNewer|removedFromOlder/.test(module),
    'the presentation module reads the raw diff lines');
});

test('the raw diff is stripped server-side too, not only left unrendered', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const strip = agent.slice(agent.indexOf('const CUSTOMER_REPORT_STRIP_KEYS'));
  const decl = strip.slice(0, strip.indexOf('\n'));
  assert.ok(decl.includes("'addedInNewer'"), 'raw diff lines still reach the customer payload');
  assert.ok(decl.includes("'removedFromOlder'"), 'raw diff lines still reach the customer payload');
});

test('a date of birth is removed from customer strings', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.ok(/BIRTH_DATE_RE/.test(agent), 'a date of birth is still shown to customers');
  const fn = agent.slice(agent.indexOf('function sanitizeCustomerString'));
  assert.ok(fn.slice(0, fn.indexOf('\n}')).includes('BIRTH_DATE_RE'),
    'the pattern is declared but never applied');
});

test('the Latin "P/N" label is removed with its number', () => {
  // Registry extracts write it in Latin as well as Georgian; stripping only
  // the digits left a dangling "P/N:" on screen.
  const agent = code('supabase/functions/research-agent/index.ts');
  const decl = agent.slice(agent.indexOf('const PERSONAL_ID_LABEL_RE'));
  assert.ok(/p\\s\*\\\/\\s\*n/.test(decl.slice(0, decl.indexOf('\n'))),
    'the Latin P/N label form is not matched');
});

test('the page renders labels through t(), never a raw key or field name', () => {
  const page = code('src/pages/VerifyPage.tsx');
  const card = page.slice(page.indexOf('function RevisionTimelineCard'));
  const body = card.slice(0, card.indexOf('\nfunction '));
  assert.ok(/t\(f\.labelKey\)/.test(body), 'fact labels are not translated');
  assert.ok(/t\(r\.kindKey\)/.test(body), 'the document kind is not translated');
  assert.ok(!/clean\(f\.key\)/.test(body), 'the raw fact key is rendered again');
  assert.ok(!/entry\.documentTitle/.test(body), 'the raw document identifier is rendered again');
  assert.ok(!/entry\.documentDate/.test(body), 'the raw PDF metadata date is rendered again');
});

test('every new key exists in all six languages', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const key of [
    'verify_doc_kind_permit',
    'verify_doc_kind_registry',
    'verify_doc_kind_other',
    'verify_docfact_building_function',
    'verify_docfact_block',
    'verify_docfact_height',
    'verify_docfact_area',
    'verify_history_compared',
    'verify_history_span',
    'verify_history_amended',
    'verify_history_none_changed',
  ]) {
    const n = bundle.split(`\n  ${key}: `).length - 1;
    assert.equal(n, 6, `${key} is defined ${n} times, expected all six languages`);
  }
});

test('the counted history copy never claims to know what changed', () => {
  // It reports how many records differ. Naming a mortgage, a lease or an
  // owner from those diffs would be inventing registry information out of
  // corrupted text — encumbrances have their own sourced surface.
  const bundle = read('src/i18n/translations.ts');
  for (const c of bundle.split('verify_history_amended: ').slice(1)) {
    const line = c.slice(0, c.indexOf('\n'));
    assert.ok(!/(mortgage|იპოთეკ|ипотек|ipotek|lease|იჯარ|аренд|kira)/i.test(line),
      'the history summary asserts an encumbrance it cannot evidence');
  }
});
