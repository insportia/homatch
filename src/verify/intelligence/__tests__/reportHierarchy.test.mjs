// The order a buyer reads the report in, and what is allowed to be in it.
//
// Two changes are being locked down here, and both are the kind that decay
// quietly:
//
// THE STANDALONE LEGAL SECTION IS GONE. As its own heading it had become a
// compliance log — somewhere to put every registry sentence whether or not it
// changed anything, safely out of the way of the report people actually read.
// But the ownership, the mortgage and the exact-unit registration ARE the
// current state of the property, so they live in SNAPSHOT with everything
// else that is true of it today. The full detail still lives in Evidence &
// Sources.
//
// RELEVANCE IS DECIDED BY WHAT THE PROPERTY IS. A plot of land has no
// building quality; a warehouse has no school run; a private resale between
// two families has no developer. A heading with nothing real under it does
// not stay empty — it gets filled, with filler or with an inventory of what
// the research could not retrieve.
//
// Nothing here may be relaxed by deleting a section key: the tests assert the
// SHAPE of the hierarchy, so removing a section fails them rather than
// trivially satisfying them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECTION_KEYS, LEGACY_SECTION_KEYS, buildIntelligencePrompt } from '../prompt.ts';
import { sectionsForAssetClass, sectionApplies, assetClassSectionNote } from '../sectionRelevance.ts';
import { parseReport, validateReport, deterministicReport, sectionTitle } from '../report.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const ROOT = process.cwd();
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

/* A report shaped like the real thing, with only what each test needs. */
const REPORT = {
  entityName: 'ტესტ ქონება',
  exactUnit: { code: '01.18.06.019.055.03.01.603' },
  legalStatus: { ownership: 'რეგისტრირებულია' },
};

const pkg = () => buildEvidencePackage(REPORT);

/* ── the hierarchy ───────────────────────────────────────────────────── */

test('the sections are the buyer hierarchy, in reading order', () => {
  assert.deepEqual([...SECTION_KEYS], [
    'SNAPSHOT',
    'PROJECT',
    'LOCATION',
    'INFRASTRUCTURE',
    'MARKET',
    'PEOPLE',
  ]);
});

test('there is no standalone legal section to write into', () => {
  assert.ok(!SECTION_KEYS.includes('LEGAL'), 'the compliance log is back as its own heading');
  assert.ok(LEGACY_SECTION_KEYS.includes('LEGAL'), 'old reports carrying one are no longer recognised');
});

test('registry facts are routed into the property, not into an appendix', () => {
  // The deterministic report is where the routing is visible without a model:
  // ownership and encumbrance evidence must land in SNAPSHOT.
  const src = read('src', 'verify', 'intelligence', 'report.ts');
  const map = src.slice(src.indexOf('const SECTION_FOR'), src.indexOf('const TITLES'));
  for (const category of ['OWNERSHIP', 'ENCUMBRANCE', 'LEGAL_CHECK', 'DOCUMENT']) {
    assert.match(map, new RegExp(`${category}: 'SNAPSHOT'`), `${category} is not part of the property's state`);
  }
});

test('the model is told what the snapshot is for, including the registry facts', () => {
  const { system } = buildIntelligencePrompt(pkg());
  assert.match(system, /SNAPSHOT\. What is true of this property TODAY/);
  assert.match(system, /registered mortgage,\nrestriction, seizure or obligation/);
  assert.match(system, /THE EXACT UNIT IS NOT THE PARENT PARCEL/);
});

test('a section the model emits out of order is sorted, not rejected', () => {
  const raw = JSON.stringify({
    summary: { label: 'BALANCED', statement: 's', highlights: [] },
    sections: [
      { key: 'MARKET', title: 'm', body: 'm', cites: [] },
      { key: 'SNAPSHOT', title: 's', body: 's', cites: [] },
      { key: 'PEOPLE', title: 'p', body: 'p', cites: [] },
      { key: 'LOCATION', title: 'l', body: 'l', cites: [] },
    ],
  });
  const parsed = parseReport(raw);
  assert.deepEqual(parsed.sections.map((s) => s.key), ['SNAPSHOT', 'LOCATION', 'MARKET', 'PEOPLE']);
});

test('a section key this pipeline no longer writes cannot be written', () => {
  const parsed = parseReport(JSON.stringify({
    summary: { label: 'BALANCED', statement: 's', highlights: [] },
    sections: [{ key: 'LEGAL', title: 'l', body: 'b', cites: [] }],
  }));
  assert.equal(parsed.sections.length, 0, 'a new report can still be given a legal appendix');
});

test('but a report that already has one keeps its heading', () => {
  // Reports written under the old structure are in the database and are what
  // those customers were given. Losing part of one is worse than showing it.
  assert.equal(sectionTitle('LEGAL'), 'სამართლებრივი და ფინანსური კონტექსტი');
  assert.equal(sectionTitle('SNAPSHOT'), 'ქონების მიმდინარე მდგომარეობა');
  const render = read('src', 'components', 'verify', 'VerifyReport.tsx');
  assert.match(render, /const READING_ORDER = /, 'the renderer does not impose the reading order');
  assert.match(render, /i === -1 \? READING_ORDER\.length : i/,
    'an unknown section key is dropped rather than placed last');
});

test('every section the pipeline can write has a Georgian heading', () => {
  for (const key of SECTION_KEYS) {
    const title = sectionTitle(key);
    assert.notEqual(title, key, `${key} renders as its own enum name`);
    assert.match(title, /[Ⴀ-ჿ]/, `${key} has no Georgian heading`);
  }
});

/* ── asset class controls relevance ──────────────────────────────────── */

test('land gets no building-quality section', () => {
  assert.equal(sectionApplies('LAND', 'PROJECT'), false);
  // And keeps everything that a plot genuinely has.
  for (const key of ['SNAPSHOT', 'LOCATION', 'INFRASTRUCTURE', 'MARKET', 'PEOPLE']) {
    assert.equal(sectionApplies('LAND', key), true, `land lost ${key}`);
  }
});

test('a private sale is not forced to have a developer', () => {
  for (const cls of ['PRIVATE_RESALE', 'PRIVATE_HOUSE', 'RENTAL']) {
    assert.equal(sectionApplies(cls, 'PROJECT'), false, `${cls} still gets a project section`);
    assert.equal(sectionApplies(cls, 'PEOPLE'), true, `${cls} lost the owner and seller`);
  }
});

test('an unclear asset class gets the whole report', () => {
  // Narrowing on a guess removes something a buyer needed. Omitting is only
  // correct when the property genuinely cannot have the section.
  for (const cls of ['MIXED_OR_UNKNOWN', 'APARTMENT_IN_PROJECT', 'COMMERCIAL', null, undefined, '']) {
    assert.deepEqual(sectionsForAssetClass(cls), [...SECTION_KEYS], `${String(cls)} was narrowed`);
  }
});

test('relevance preserves reading order rather than inventing a second one', () => {
  const kept = sectionsForAssetClass('LAND');
  assert.deepEqual(kept, SECTION_KEYS.filter((k) => k !== 'PROJECT'));
});

test('the model is told which sections this property can have', () => {
  const land = buildIntelligencePrompt(pkg(), undefined, 'LAND').system;
  assert.ok(!/"<SNAPSHOT\|PROJECT/.test(land), 'PROJECT is still offered for a plot of land');
  assert.match(land, /THIS IS LAND\. There is no building\./);

  const flat = buildIntelligencePrompt(pkg(), undefined, 'APARTMENT_IN_PROJECT').system;
  assert.match(flat, /"key": "<SNAPSHOT\|PROJECT\|LOCATION\|INFRASTRUCTURE\|MARKET\|PEOPLE>"/);
});

test('commercial space is told not to write family-living filler', () => {
  const note = assetClassSectionNote('COMMERCIAL');
  assert.match(note, /Do NOT write family-living filler/);
  assert.match(note, /footfall and visibility/);
  // It keeps every section — what changes is what they are about.
  assert.deepEqual(sectionsForAssetClass('COMMERCIAL'), [...SECTION_KEYS]);
});

test('a class with nothing special to say adds no instruction', () => {
  assert.equal(assetClassSectionNote('APARTMENT_IN_PROJECT'), '');
  assert.equal(assetClassSectionNote(null), '');
});

test('the instruction and the rule that enforces it agree', () => {
  // A note telling the model to skip a section that is not actually excluded,
  // or an exclusion with no note, both end with a report that reads as though
  // something is missing.
  for (const cls of ['LAND', 'PRIVATE_HOUSE', 'PRIVATE_RESALE', 'RENTAL']) {
    assert.ok(assetClassSectionNote(cls).length > 0, `${cls} excludes a section silently`);
    assert.ok(!sectionApplies(cls, 'PROJECT'), `${cls} is told to skip PROJECT but allowed to write it`);
    assert.match(assetClassSectionNote(cls), /PROJECT section/, `${cls}'s note does not name the section`);
  }
});

/* ── next steps ──────────────────────────────────────────────────────── */

test('a next step must rest on something the report established', () => {
  // The checklist this replaced was made of our own retrieval gaps handed to
  // the buyer as homework. A citation is what makes that impossible.
  const p = pkg();
  const withUncited = {
    summary: { label: 'BALANCED', statement: 's', highlights: [{ dimension: 'LEGAL_CONTEXT', sentiment: 'BALANCED', headline: 'h', detail: 'd', cites: [] }] },
    keyFindings: [],
    sections: [{ key: 'SNAPSHOT', title: 't', body: 'b', metrics: [], cites: [] }],
    attentionPoints: [],
    nextSteps: [{ step: 'გადაამოწმეთ ექსპლუატაციაში მიღება', why: 'ვერ მოვიძიეთ', cites: [] }],
  };
  const { problems } = validateReport(p, withUncited);
  assert.ok(problems.some((x) => /next step rests on nothing/.test(x)),
    'a step grounded in nothing was accepted');
});

test('zero next steps is a valid report', () => {
  const parsed = parseReport(JSON.stringify({
    summary: { label: 'POSITIVE', statement: 's', highlights: [] },
    sections: [{ key: 'SNAPSHOT', title: 't', body: 'b', cites: [] }],
  }));
  assert.deepEqual(parsed.nextSteps, []);
});

test('next steps are capped, so the plan cannot become a checklist again', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ step: `s${i}`, why: 'w', cites: ['e1'] }));
  const parsed = parseReport(JSON.stringify({
    summary: { label: 'BALANCED', statement: 's', highlights: [] },
    sections: [{ key: 'SNAPSHOT', title: 't', body: 'b', cites: [] }],
    nextSteps: many,
  }));
  assert.equal(parsed.nextSteps.length, 4);
});

test('the deterministic report offers no next steps at all', () => {
  // Deterministic means no interpretation, and a step IS an interpretation.
  const r = deterministicReport(pkg());
  assert.deepEqual(r.nextSteps, []);
  assert.equal(r.mode, 'DETERMINISTIC');
});

test('the old checklist stays deleted by name', () => {
  const { system } = buildIntelligencePrompt(pkg());
  assert.match(system, /There is NO "buyerActions" field and there is no pre-purchase checklist/);
  assert.match(system, /nextSteps is NOT it/);
  assert.match(system, /NEVER write a step whose reason is that our research could not retrieve something/);
  assert.ok(!/"buyerActions":/.test(system), 'the prompt asks for the deleted field');
});

test('the steps a buyer can run themselves are not duplicated into the plan', () => {
  const { system } = buildIntelligencePrompt(pkg());
  assert.match(system, /rendered separately and deterministically/);
});

test('the renderer shows a plan only when there is one', () => {
  const render = read('src', 'components', 'verify', 'VerifyReport.tsx');
  assert.match(render, /\{r\.nextSteps\?\.length \? \(/, 'an empty plan still renders a heading');
  assert.match(render, /verify_ir_next_steps_title/);
  const en = read('src', 'i18n', 'translations.ts');
  assert.equal((en.match(/verify_ir_next_steps_title:/g) ?? []).length, 6,
    'the heading is missing in some language');
});
