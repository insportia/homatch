// The land, the building, and the flat are three different things — and a
// buyer must never be left thinking a finding about one is a finding about
// another.
//
// This matters most for encumbrances. A mortgage registered against the land
// plot is not a mortgage against flat 601, and exactUnit.verified is false on
// EVERY report in production: the unit's own status is precisely what has not
// been confirmed.
//
// Also covers §9: several of these fixes act at the serve/presentation
// boundary, so the historical report SHAPES — the ones already sitting in the
// database, with fields the pipeline no longer produces — have to be safe too,
// without re-running any paid research.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parcelRelation, parentParcelCode, parentDisplayName } from '../cadastral.ts';
import { propertyTypeDisplay } from '../propertyType.ts';
import { resolveAssetClass } from '../researchPlan.ts';
import { buildDocumentRows, summarizeOfficialDocuments, summarizeDocumentHistory } from '../documentPresentation.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

/* ── scope: the unit is not the parcel ───────────────────────────────── */

test('an unconfirmed unit is never presented as confirmed', () => {
  // Only a literal true counts. A truthy string is what a JSON round-trip
  // can easily produce and must not be mistaken for confirmation.
  for (const v of ['true', 'yes', 1, {}, [], 'false', null, undefined]) {
    assert.equal(parcelRelation({ exactUnit: { code: '01.18.06.019.055.03.01.601', verified: v } }).unitVerified, false,
      `verified=${JSON.stringify(v)} was read as confirmation`);
  }
  assert.equal(parcelRelation({ exactUnit: { code: '01.18.06.019.055.03.01.601', verified: true } }).unitVerified, true);
});

test('the parcel is derived from the code, not from a field that may be empty', () => {
  // identifiedParent.code is null in production. Depending on it is what
  // silently switched the whole distinction off.
  const rel = parcelRelation({
    exactUnit: { code: '01.18.06.019.055.03.01.601', verified: false },
    identifiedParent: { code: null, name: 'საკადასტრო კოდი 01.18.06.019.055' },
  });
  assert.equal(rel.parcelCode, '01.18.06.019.055');
  assert.equal(rel.differs, true);
});

test('a parcel-scope caveat is shown exactly when the unit is unconfirmed', () => {
  const page = code('src/pages/VerifyPage.tsx');
  const card = page.slice(page.indexOf('function RightsAndRestrictionsCard'));
  const body = card.slice(0, card.indexOf('\nfunction '));

  assert.ok(/parcelRelation\(report\)/.test(body), 'the rights card does not know the parcel relation');
  assert.ok(/rel\.differs&&!rel\.unitVerified/.test(body),
    'the caveat is not tied to an unconfirmed unit with a distinct parcel');
  assert.ok(/verify_rights_scope_caveat/.test(body), 'no scope caveat is rendered');
});

test('the scope caveat says the findings may belong to the plot', () => {
  const bundle = read('src/i18n/translations.ts');
  const copies = bundle.split('verify_rights_scope_caveat: ').slice(1);
  assert.equal(copies.length, 6, 'the caveat is not defined in all six languages');
  for (const c of copies) {
    const line = c.slice(0, c.indexOf('\n'));
    assert.ok(/land plot|მიწის ნაკვეთ|земельн|arsa|قطعة الأرض|מגרש/i.test(line),
      'the caveat never mentions the land plot');
  }
});

test('a mortgage on the plot is not evidence about the flat', () => {
  // The report may legitimately state a parent-parcel mortgage. What it must
  // not do is let that stand as the unit's own confirmed position.
  const withParcelMortgage = {
    exactUnit: { code: '01.18.06.019.055.03.01.601', verified: false },
    identifiedParent: { code: null, name: 'საკადასტრო კოდი 01.18.06.019.055' },
    rightsAndRestrictions: { status: 'RESTRICTION_IDENTIFIED', items: ['იპოთეკა: სს საქართველოს ბანკი'] },
  };
  const rel = parcelRelation(withParcelMortgage);
  assert.equal(rel.differs, true, 'the parcel and the unit were treated as one');
  assert.equal(rel.unitVerified, false, 'an unconfirmed unit was reported as confirmed');
});

test('a bare parcel query has no unit to confuse with the parcel', () => {
  const rel = parcelRelation({ exactUnit: { code: '01.19.30.004.128', verified: true } });
  assert.equal(rel.differs, false);
  assert.equal(parentParcelCode('01.19.30.004.128'), null);
});

/* ── §9: the shapes already sitting in the database ──────────────────── */

/** A report from before assetClass existed at all. */
const PRE_ASSET_CLASS = {
  queryType: 'cadastral',
  entityType: 'REAL_ESTATE_UNIT',
  exactUnit: { code: '01.18.06.019.055.03.01.603', verified: false },
  identifiedParent: { code: null, name: 'საკადასტრო კოდი 01.18.06.019.055' },
  projectProfile: { name: 'Villion', developer: 'Millenio Group' },
  companyProfile: { name: 'შპს „მილენიო გრუპი“', idCode: '404670272' },
};

/** A report whose entityType carried a semicolon caveat. */
const CAVEATED = {
  queryType: 'cadastral',
  assetClass: 'MIXED_OR_UNKNOWN',
  entityType: 'ცალკე საკადასტრო ერთეული; ფუნქციური სახეობა დაუდასტურებელია',
  exactUnit: { code: '01.18.06.019.055.03.01.601', verified: false },
  identifiedParent: { code: null, name: null },
  projectProfile: null,
};

/** A report with landProfile present but JSON-null — the shape that made a
 *  SQL simulation classify every apartment as land. */
const NULL_PROFILES = {
  queryType: 'cadastral',
  assetClass: null,
  entityType: 'ინდივიდუალური ერთეული (ბინა / ფართი)',
  exactUnit: { code: '01.18.06.019.055.03.01.603', verified: false },
  landProfile: null,
  projectProfile: null,
  companyProfile: null,
};

test('a pre-assetClass report is classified on read from its own evidence', () => {
  assert.equal(resolveAssetClass(PRE_ASSET_CLASS), 'APARTMENT_IN_PROJECT');
  assert.deepEqual(propertyTypeDisplay({ ...PRE_ASSET_CLASS, assetClass: resolveAssetClass(PRE_ASSET_CLASS) }), {
    kind: 'LABEL',
    labelKey: 'verify_asset_apartment_in_project',
  });
});

test('a historical raw enum never reaches the badge', () => {
  // REAL_ESTATE_UNIT was a real production entityType.
  assert.deepEqual(propertyTypeDisplay({ ...PRE_ASSET_CLASS, assetClass: 'MIXED_OR_UNKNOWN' }), { kind: 'NONE' });
});

test('a semicolon-caveated historical label is not shown as a badge', () => {
  assert.deepEqual(propertyTypeDisplay(CAVEATED), { kind: 'NONE' });
});

test('a present-but-null profile is not mistaken for evidence', () => {
  // landProfile is a KEY with a null value. Testing for the key rather than
  // a value classifies every apartment in the database as a land plot.
  assert.equal(resolveAssetClass(NULL_PROFILES), 'MIXED_OR_UNKNOWN');
});

test('the historical parent name that is only a code is not shown as a name', () => {
  assert.equal(parentDisplayName(PRE_ASSET_CLASS.identifiedParent.name), null);
});

test('historical document shapes render without leaking their identifiers', () => {
  // Exactly the rows a pre-fix report carries.
  const rows = buildDocumentRows([
    { documentTitle: 'NAPR registration 892024224686', documentDate: "D:20240823122736+00'00'", facts: [{ key: 'buildingFunction', value: 'არასასოფლო' }] },
    { documentTitle: 'AR11026464 შედეგის ნახვა 1', documentDate: null, facts: [{ key: 'applicant', value: 'გიორგი ლეჟავა პ/ნ 01008057813' }] },
    { documentTitle: 'AR11026464 28/03/2024', documentDate: null, facts: [] },
  ]);
  const printed = JSON.stringify(rows);
  for (const leak of ['NAPR', 'AR11', 'D:2024', 'პ/ნ', '01008057813', 'applicant', 'buildingFunction']) {
    assert.ok(!printed.includes(leak), `${leak} survived into a rendered row`);
  }
  assert.ok(rows.length >= 1, 'every historical row was dropped');
});

test('a historical document list is grouped, never enumerated by identifier', () => {
  const groups = summarizeOfficialDocuments([
    { title: 'ABSTRACT N:882009400862', date: '2009-12-07' },
    { title: 'NAPR registration 892024224686', date: "D:20240823122736+00'00'" },
    { title: 'AR1990786 20/09/2023', date: null },
    { title: 'AR1990786 შედეგის ნახვა 1', date: null },
  ]);
  const printed = JSON.stringify(groups);
  for (const leak of ['ABSTRACT', 'NAPR', 'AR19', 'D:2024']) {
    assert.ok(!printed.includes(leak), `${leak} survived into the document summary`);
  }
});

test('a historical diff payload yields a count, never its lines', () => {
  // addedInNewer/removedFromOlder are stripped server-side; even if a
  // historical payload still carried them, nothing reads them.
  const summary = summarizeDocumentHistory({
    available: true,
    documentsConsidered: 8,
    comparisons: [
      { changed: true, addedInNewer: ['ÌÀÒÉÍÀ ÊÀÝÉÔÀÞÄ ,P/N: 01018001305'], removedFromOlder: ['x'], olderDocument: { date: '2009-12-07' }, newerDocument: { date: '2011-01-13' } },
    ],
  });
  const printed = JSON.stringify(summary);
  assert.ok(!/ÌÀÒÉÍÀ/.test(printed), 'mojibake reached the history summary');
  assert.ok(!/01018001305/.test(printed), 'a personal number reached the history summary');
  assert.equal(summary.changedCount, 1);
});

test('no historical shape throws anywhere in the presentation path', () => {
  for (const fixture of [PRE_ASSET_CLASS, CAVEATED, NULL_PROFILES, {}, null, undefined]) {
    assert.doesNotThrow(() => {
      resolveAssetClass(fixture);
      propertyTypeDisplay(fixture);
      parcelRelation(fixture);
    }, `a historical shape threw: ${JSON.stringify(fixture)}`);
  }
});
