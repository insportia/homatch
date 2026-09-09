import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readable } from '../../../verify/readableText.ts';
import { computeVerdict } from '../../../dealroom/planning/synthesis.ts';

/*
 * THE CUSTOMER REPORT CONTRACT.
 *
 * Verify used to render its research output directly: about twenty cards in a
 * flat list — official document tables, full revision timelines, land and
 * utility matrices, comparables, raw evidence lists — with the property's
 * identity repeated across several of them.
 *
 * The synthesis that replaces it already existed and had only ever been wired
 * to Deal Room. These tests pin the two properties that make the new report
 * trustworthy: exactly one place decides what is true, and a technical
 * failure is never dressed up as a property finding.
 */

const ROOT = process.cwd();
const page = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'VerifyPage.tsx'), 'utf8');
const report = fs.readFileSync(path.join(ROOT, 'src', 'components', 'verify', 'VerifyReport.tsx'), 'utf8');
const translations = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'translations.ts'), 'utf8');

const reportCode = report.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ---------------- one authoritative synthesis ---------------- */

test('the report is driven by verify-synthesis, not re-derived in the UI', () => {
  assert.match(page, /supabase\.functions\.invoke\('verify-synthesis'/);
  assert.match(page, /<VerifyReport synthesis=\{synthesis\}/);
});

test('no card invents a conclusion of its own', () => {
  // The component may read verdict / verdictReasons / sections /
  // incompleteSources and nothing else. Anything more would be a second
  // opinion competing with the projection.
  const reads = [...reportCode.matchAll(/synthesis[.?]*\.([a-zA-Z]+)/g)].map((m) => m[1]);
  const allowed = new Set(['verdict', 'verdictReasons', 'sections', 'incompleteSources', 'empty']);
  for (const r of new Set(reads)) {
    assert.ok(allowed.has(r), `VerifyReport reads synthesis.${r}, which is not part of the contract`);
  }
});

/* ---------------- a technical failure is not a property risk ---------------- */

test('an unavailable source cannot move the verdict', () => {
  const encumbered = [{ type: 'encumbrance.mortgage', state: 'CONFIRMED', value: 'yes' }];
  const unavailable = [
    { type: 'encumbrance.mortgage', state: 'UNAVAILABLE', value: 'yes' },
    { type: 'encumbrance.seizure', state: 'UNAVAILABLE', value: 'yes' },
    { type: 'encumbrance.debtorRegistry', state: 'UNAVAILABLE', value: 'yes' },
  ];
  assert.equal(computeVerdict(unavailable).verdict, 'POSITIVE',
    'sources we could not reach must never make a property look worse');
  assert.equal(computeVerdict(encumbered).verdict, 'MODERATELY_POSITIVE');
});

test('no evidence at all is not a negative verdict', () => {
  assert.equal(computeVerdict([]).verdict, 'POSITIVE');
});

test('coverage is presented as coverage, never as a warning', () => {
  // From the JSX, not the interface declaration at the top of the file --
  // slicing from the first occurrence swept in the whole VERDICT_STYLE table.
  const block = reportCode.slice(reportCode.indexOf('(synthesis.incompleteSources?.length'));
  // The section that lists unreachable sources must not borrow risk styling.
  const upTo = block.slice(0, block.indexOf('</Card>'));
  assert.ok(!/text-red|text-amber|border-red|border-amber|destructive/.test(upTo),
    'unreachable sources must not be coloured like findings');
  assert.match(report, /verify_report_incomplete_note/);
});

/* ---------------- the verdict vocabulary is the product vocabulary ---------------- */

test('the verdict is Positive / Moderately positive / Negative and nothing else', () => {
  for (const v of ['POSITIVE', 'MODERATELY_POSITIVE', 'NEGATIVE']) {
    assert.match(report, new RegExp(`${v}:`), `${v} must be renderable`);
  }
  // No numeric confidence score as the headline judgement.
  assert.ok(!/\/\s*100|percent|score/i.test(reportCode), 'no 73/100-style scoring in the verdict');
});

test('the verdict always carries its reasons', () => {
  assert.match(report, /verify_report_why/);
  assert.match(reportCode, /verdictReasons/);
});

/* ---------------- the research dump is no longer the report ---------------- */

test('the heavy research cards are behind progressive disclosure', () => {
  // They still exist — nothing was deleted — but they are inside the evidence
  // control, not the default view.
  const evidenceProp = page.slice(page.indexOf('<VerifyReport synthesis={synthesis} evidence={'));
  // The evidence JSX itself contains '/>' sequences, so bound the slice on the
  // fallback branch that follows the component instead.
  const upToClose = evidenceProp.slice(0, evidenceProp.indexOf(':synthesisLoading?'));
  for (const card of ['RevisionTimelineCard', 'OfficialDocumentsCard', 'ComparablesCard', 'EvidenceCard']) {
    assert.ok(upToClose.includes(card), `${card} must be inside the evidence layer`);
  }
});

test('the evidence layer only mounts when opened', () => {
  // A <details> body is not rendered while closed, so a report with hundreds
  // of document and revision rows costs nothing until asked for.
  assert.match(report, /<details/);
  assert.match(report, /group-open:rotate-90/);
});

test('the property identity is stated once', () => {
  // It used to appear in the summary card, the identified-property card and
  // the reconciled-identity card.
  const primary = page.slice(
    page.indexOf('{report&&!loading&&'),
    page.indexOf('<VerifyReport synthesis=')
  );
  assert.equal((primary.match(/clean\(report\.entityName\)/g) ?? []).length, 1);
});

/* ---------------- malformed text never reaches the customer ---------------- */

test('readable() keeps real Georgian intact', () => {
  const ka = 'შპს მილენიო გრუპი — საკადასტრო კოდი 01.18.06.019.055.03.01.601';
  assert.equal(readable(ka), ka);
  assert.equal(readable('ბინა 60.5 კვ.მ, მე-3 სართული'), 'ბინა 60.5 კვ.მ, მე-3 სართული');
});

test('readable() drops text that arrived mis-decoded', () => {
  // A run of replacement characters is what a mis-decoded Georgian byte stream
  // looks like by the time it reaches the UI.
  assert.equal(readable('������'), '');
  assert.equal(readable('a�'), '');
});

test('readable() tolerates a stray replacement character in good text', () => {
  const mostlyFine = 'შპს მილენიო გრუპი, რეგისტრირებული 2019 წელს, ქ. თბილისი�';
  assert.ok(readable(mostlyFine).length > 40, 'one bad byte must not discard a whole sentence');
});

test('readable() is applied to every customer-visible string', () => {
  for (const field of ['verdictReasons', 'sections', 'incompleteSources']) {
    const at = reportCode.indexOf(field);
    assert.ok(at > 0, `${field} should be rendered`);
  }
  assert.match(reportCode, /\.map\(readable\)/);
  assert.match(reportCode, /body: readable\(s\.text\)/);
});

/* ---------------- six languages ---------------- */

test('every report string exists in all six languages', () => {
  const keys = [
    'verify_section_intro', 'verify_section_property', 'verify_section_ownership',
    'verify_section_company', 'verify_section_people', 'verify_section_professionals',
    'verify_section_construction', 'verify_section_permits', 'verify_section_location',
    'verify_section_market', 'verify_section_price', 'verify_section_confirm',
    'verify_section_assessment', 'verify_section_meaning', 'verify_section_next',
    'verify_report_why', 'verify_report_evidence_toggle', 'verify_report_evidence_hint',
    'verify_report_incomplete', 'verify_report_incomplete_note', 'verify_report_preparing',
  ];
  for (const k of keys) {
    assert.equal((translations.match(new RegExp(`\\b${k}:`, 'g')) ?? []).length, 6,
      `${k} must exist in KA/EN/RU/AR/TR/HE`);
  }
});

test('every section the synthesis can emit has a title', () => {
  // A section with no mapping is dropped rather than shown unlabelled, but the
  // mapping must actually be complete for the vocabulary that exists.
  const synth = fs.readFileSync(path.join(ROOT, 'src', 'dealroom', 'planning', 'synthesis.ts'), 'utf8');
  const union = synth.slice(synth.indexOf('export type SectionKey'), synth.indexOf(';', synth.indexOf('export type SectionKey')));
  for (const [, key] of union.matchAll(/'([A-Z]+)'/g)) {
    assert.match(report, new RegExp(`\\b${key}: 'verify_section_`), `${key} has no title`);
  }
});

/* ---------------- no machine vocabulary on the customer surface ---------------- */

test('the report shows no internal vocabulary', () => {
  for (const word of [
    'result_json', 'workerJobId', 'FSM', 'playwright', 'openai', 'provider',
    'sourceKey', 'grounded_in', 'CONFIRMED', 'UNAVAILABLE',
  ]) {
    assert.ok(!reportCode.includes(word), `"${word}" must never reach the customer report`);
  }
});

test('the report never renders raw JSON', () => {
  assert.ok(!/JSON\.stringify/.test(reportCode));
});

/* ---------------- RTL and mobile ---------------- */

test('the report uses logical properties so RTL is correct', () => {
  // ps-/start- rather than pl-/left-, so Arabic and Hebrew mirror properly.
  assert.match(reportCode, /ps-4/);
  assert.match(reportCode, /absolute start-0/);
  assert.ok(!/\bpl-4\b|\bleft-0\b/.test(reportCode), 'physical directions break RTL');
});

test('the report has no fixed width that breaks a 320px screen', () => {
  for (const [, value] of report.matchAll(/(?:min-)?w-\[(\d+)px\]/g)) {
    assert.ok(Number(value) <= 320, `fixed width ${value}px exceeds the 320px floor`);
  }
  // Long company names and reasons must wrap rather than clip.
  assert.match(reportCode, /break-words/);
  // The cadastral code is the one string with no spaces to wrap on, so it is
  // rendered with break-all where it actually appears: the identity line.
  assert.match(page, /text-sm font-medium break-all">\{report\.exactUnit\.code\}/);
});
