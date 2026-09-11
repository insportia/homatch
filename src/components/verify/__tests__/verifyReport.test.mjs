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
  const allowed = new Set([
    // `location`, like `market` and `people`, is computed deterministically in
    // the intelligence bundle and rendered as given. It is not a second
    // opinion: the component displays the places a source named and the
    // district context, and reaches no conclusion of its own about either.
    'report', 'evidence', 'snapshot', 'market', 'location', 'people', 'selfChecks', 'mode', 'empty',
  ]);
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

test('an incomplete check is advice, never a warning', () => {
  // v2 removed the dedicated "could not confirm" block entirely: incomplete
  // checks now arrive as buyerActions and as the buyer's own official
  // self-checks. Neither may borrow risk styling.
  assert.ok(!/unconfirmed/i.test(reportCode), 'the deficit block is back');

  const actions = reportCode.slice(reportCode.indexOf('r.buyerActions?.length'));
  const actionsBlock = actions.slice(0, actions.indexOf('</section>'));
  assert.ok(!/text-red|text-amber|border-red|border-amber|destructive/.test(actionsBlock),
    'buyer actions must not be coloured like findings');

  const self = reportCode.slice(reportCode.indexOf('const SelfChecks'));
  assert.ok(!/text-red|border-red|destructive/.test(self.slice(0, 2000)),
    'official self-checks must not be coloured like findings');

  // Attention points MAY carry a restrained accent — they are real findings.
  const attention = reportCode.slice(reportCode.indexOf('r.attentionPoints?.length'));
  assert.match(attention.slice(0, attention.indexOf('</section>')), /amber/);
});

/* ---------------- the verdict vocabulary is the product vocabulary ---------------- */

test('the overall view is one of the three permitted readings and nothing else', () => {
  // Three, not four. MOSTLY_POSITIVE and MIXED were a distinction without a
  // difference to a reader, and "mixed" reads as a problem when most
  // properties are simply ordinary.
  for (const v of ['POSITIVE', 'BALANCED', 'NEEDS_ATTENTION']) {
    assert.match(report, new RegExp(`${v}:`), `${v} must be renderable`);
  }
  // No numeric confidence score as the headline judgement.
  assert.ok(!/\/\s*100|percent|score/i.test(reportCode), 'no 73/100-style scoring in the overall view');
});

test('the summary is a verdict WITH its reasons, not a traffic light', () => {
  // The label names the state; the statement carries the judgement; the
  // highlights carry what it rests on. A coloured chip alone would be exactly
  // the compliance-robot output this report replaced.
  assert.match(reportCode, /summary\.statement/);
  assert.match(reportCode, /summary\.highlights/);
  assert.ok(!/ShieldCheck|ShieldX|traffic/.test(reportCode), 'the verdict chip is back');
  // Restraint: the whole thing must not turn green because the news is good.
  assert.ok(/SENTIMENT_STYLE/.test(reportCode), 'sentiment styling is not centralised');
  // Colour is allowed to mark a state, not to flood the page. Every sentiment
  // class must be a small dot or a left edge — never a filled panel, and never
  // the destructive palette, which would make "look at this" read as "danger".
  const styleBlock = reportCode.slice(reportCode.indexOf('SENTIMENT_STYLE'), reportCode.indexOf('sentimentOf'));
  assert.ok(!/bg-destructive|bg-red-|text-red-/.test(styleBlock), 'the danger palette is back');
  for (const cls of styleBlock.match(/bg-[a-z0-9-]+(?:\/\d+)?/g) ?? []) {
    assert.match(cls, /\/\d+$/, `${cls} is a solid fill — sentiment colour must stay muted`);
  }
  assert.ok(!/bg-emerald|bg-amber/.test(reportCode.replace(styleBlock, '')),
    'sentiment colour leaked outside the one place that owns it');
});

test('a summary highlight is scannable: dimension, headline, then detail', () => {
  for (const bit of ['h.dimension', 'h.headline', 'h.detail', 'verify_dim_']) {
    assert.ok(reportCode.includes(bit), `${bit} is missing from the summary`);
  }
});

test('key findings each carry why they matter', () => {
  assert.ok(reportCode.includes('f.whyItMatters'),
    'findings render without their consequence — that is a fact list again');
  assert.ok(/slice\(0, 7\)/.test(reportCode), 'the findings shortlist is uncapped');
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

test('every customer-visible string is cleaned before it renders', () => {
  for (const field of ['summary', 'keyFindings', 'sections', 'attentionPoints', 'finalView']) {
    assert.ok(reportCode.indexOf(field) > 0, `${field} should be rendered`);
  }
  // v2 routes every string through clean(), which is readable() — the
  // mis-decoded-text guard — composed with the leaked-id strip. One helper,
  // so a new field cannot accidentally skip one of the two.
  assert.match(reportCode, /const clean = \(s: unknown\): string => stripEvidenceIds\(readable\(/);
  for (const call of [
    'clean(s.title)', 'clean(a.point)', 'clean(a.why)',
    'clean(f.finding)', 'clean(f.whyItMatters)',
    'clean(h.headline)', 'clean(h.detail)', 'clean(summary.statement)',
  ]) {
    assert.ok(reportCode.includes(call), `${call} is missing — that string can render raw`);
  }
});

/* ---------------- six languages ---------------- */

test('every report string the UI renders exists in all six languages', () => {
  // This used to assert a hand-written list of verify_section_* keys. Those
  // belonged to the pre-v2 report, where the UI held a map of section titles.
  // Titles now travel WITH each section — the very next test documents that —
  // so the list had been asserting the continued existence of keys no
  // component reads, and it broke the moment the dead-key sweep removed them.
  //
  // Reading the keys out of the component instead means this can never again
  // drift from what the report actually renders.
  // Counting with split(), not RegExp built from a template literal.
  // a word-boundary escape inside a template literal is a BACKSPACE character,
  // boundary — the same escape trap that once shipped a 0x08 byte into a
  // production regex. String matching removes the trap entirely.
  const used = [...report.matchAll(/t\(\s*'([a-z0-9_]+)'\s*\)/g)].map((m) => m[1]);
  const unique = [...new Set(used)];
  assert.ok(unique.length >= 8, `expected the report to render several keys, found ${unique.length}`);
  for (const k of unique) {
    const defined = translations.split(`
  ${k}: `).length - 1;
    assert.equal(defined, 6, `${k} is rendered by the report but defined in ${defined} of 6 languages`);
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
  assert.match(reportCode, /clean\(s\.title\)/, 'the server-supplied title is not rendered');
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

/* ---------------- the pre-purchase checklist is gone ---------------- */

test('"რას გავაკეთებდი ყიდვამდე" is removed, not relocated', () => {
  // It had become a bin: every field the pipeline failed to populate turned
  // into a near-identical "confirm before signing" line, so a reader had no
  // way to tell which one mattered. Advice now lives in the section that
  // gives it meaning.
  assert.ok(!reportCode.includes('buyerActions'), 'the checklist is still rendered');
  assert.ok(!reportCode.includes('verify_ir_actions_title'), 'the checklist heading survives');
  assert.ok(!/გავაკეთებდი/.test(report), 'the checklist heading text is still in the component');

  // Comments stripped: a header explaining WHY the field was removed must not
  // read as the field still being there.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const contract = strip(fs.readFileSync(path.join(ROOT, 'src/verify/intelligence/report.ts'), 'utf8'));
  assert.ok(!contract.includes('buyerActions'), 'buyerActions survives in the report contract');
  assert.ok(!contract.includes('BuyerAction'), 'the BuyerAction type survives');

  const prompt = strip(fs.readFileSync(path.join(ROOT, 'src/verify/intelligence/prompt.ts'), 'utf8'));
  // The prompt must not REQUEST the field in the JSON shape it asks for...
  assert.ok(!/"buyerActions":/.test(prompt), 'the prompt still asks for buyer actions');
  // ...while still explicitly forbidding the model from inventing it back.
  assert.ok(/There is NO "buyerActions" field/.test(prompt), 'the model is not told the field is gone');
  assert.ok(/noPrePurchaseChecklist/.test(prompt), 'the prompt does not forbid recreating it');

  const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/verify-synthesis/index.ts'), 'utf8');
  assert.ok(!fn.includes('buyerActions'), 'the edge function still returns buyer actions');
});

test('participants survive even when the prose does not reach them', () => {
  // The directors regression: people were extracted and then not shown.
  assert.ok(reportCode.includes('CompanyGraph'), 'there is no participant block');
  assert.ok(/!sections\.some\(\(s\) => s\.key === 'PEOPLE'\)/.test(reportCode),
    'people are only shown when the model wrote a PEOPLE section');
});

test('ownership is shown only when the register stated it', () => {
  assert.ok(/typeof p\.ownershipPct === 'number'/.test(reportCode),
    'ownership is rendered without checking it exists');
  // A director is not a shareholder, and nothing may infer one from the other.
  assert.ok(!/role === 'DIRECTOR'[^\n]*ownership/i.test(reportCode),
    'ownership is being inferred from a directorship');
});
