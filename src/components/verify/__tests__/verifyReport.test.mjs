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
  const allowed = new Set(['report', 'evidence', 'incompleteSources', 'mode', 'empty']);
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
  const block = reportCode.slice(reportCode.indexOf('r.unconfirmed?.length'));
  // The section that lists what could not be established must not borrow risk
  // styling: a check we could not finish says nothing about the property.
  const upTo = block.slice(0, block.indexOf('</section>'));
  assert.ok(!/text-red|text-amber|border-red|border-amber|destructive/.test(upTo),
    'unconfirmed checks must not be coloured like findings');
  assert.match(report, /verify_ir_unconfirmed_note/);

  // Attention points MAY carry a restrained accent — they are real findings.
  const attention = reportCode.slice(reportCode.indexOf('r.attentionPoints?.length'));
  assert.match(attention.slice(0, attention.indexOf('</section>')), /amber/);
});

/* ---------------- the verdict vocabulary is the product vocabulary ---------------- */

test('the overall view is one of the four permitted readings and nothing else', () => {
  for (const v of ['POSITIVE', 'MOSTLY_POSITIVE', 'MIXED', 'NEEDS_ATTENTION']) {
    assert.match(report, new RegExp(`${v}:`), `${v} must be renderable`);
  }
  // No numeric confidence score as the headline judgement.
  assert.ok(!/\/\s*100|percent|score/i.test(reportCode), 'no 73/100-style scoring in the overall view');
});

test('the overall view is a sentence, not a traffic light', () => {
  // The label names the section; the STATEMENT carries the judgement. A
  // coloured chip alone would be exactly the compliance-robot output this
  // report replaced.
  assert.match(reportCode, /overallView\?\.statement/);
  assert.match(reportCode, /executiveSummary/);
  assert.ok(!/ShieldCheck|ShieldX|traffic/.test(reportCode), 'the verdict chip is back');
});

/* ---------------- the research dump is no longer the report ---------------- */

test('the heavy research cards are behind progressive disclosure', () => {
  // They still exist — nothing was deleted — but they are inside the evidence
  // control, not the default view.
  const evidenceProp = page.slice(page.indexOf('<VerifyReport synthesis={synthesis}'));
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
  for (const field of ['executiveSummary', 'sections', 'attentionPoints', 'buyerActions', 'unconfirmed', 'finalView']) {
    assert.ok(reportCode.indexOf(field) > 0, `${field} should be rendered`);
  }
  // Every string that reaches the screen goes through readable(), which is
  // what keeps mis-decoded registry text out of the report.
  for (const call of [
    'readable(s.title)', 'readable(a.point)', 'readable(a.why)',
    'readable(a.action)', 'readable(u.item)', 'readable(r.overallView.statement)',
  ]) {
    assert.ok(reportCode.includes(call), `${call} is missing — that string can render raw`);
  }
  assert.match(reportCode, /readable\(text\)/);
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

test('every section the report can emit is titled by the server, never left bare', () => {
  // Titles now travel WITH each section (the model writes them in the reader's
  // language), so the UI does not hold a key map. What must hold instead is
  // that the deterministic fallback — the path taken when the model output is
  // rejected — can title every key it is allowed to emit.
  const prompt = fs.readFileSync(path.join(ROOT, 'src', 'verify', 'intelligence', 'prompt.ts'), 'utf8');
  const rpt = fs.readFileSync(path.join(ROOT, 'src', 'verify', 'intelligence', 'report.ts'), 'utf8');
  const union = prompt.slice(prompt.indexOf('export const SECTION_KEYS'), prompt.indexOf('] as const'));
  const keys = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 5, 'the section vocabulary was not found');
  const titles = rpt.slice(rpt.indexOf('const TITLES'), rpt.indexOf('};', rpt.indexOf('const TITLES')));
  for (const key of keys) {
    assert.ok(titles.includes(`${key}:`), `${key} has no deterministic title`);
  }
  assert.match(reportCode, /readable\(s\.title\)/, 'the server-supplied title is not rendered');
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
  assert.match(reportCode, /border-s-2/);
  assert.ok(!/\bpl-4\b|\bleft-0\b|\bborder-l-2\b/.test(reportCode), 'physical directions break RTL');
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
