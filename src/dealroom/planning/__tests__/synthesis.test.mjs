import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSynthesisPlan, computeVerdict, validateRendering } from '../synthesis.ts';
import { normalizeEvidence } from '../evidence.ts';
import { buildProgressView } from '../researchActivity.ts';

/*
 * FINAL SYNTHESIS GROUNDING.
 *
 * The plan is deterministic; a model only chooses words. These tests hold the
 * line that makes that safe: a point cannot exist without evidence, conflicts
 * cannot be quietly dropped, and technical failures cannot move the verdict.
 */

const claim = (over) => ({
  type: 'ownership.owner', value: 'შპს მილენიო გრუპი',
  source: 'enreg', documentRef: 'B24099518', ...over,
});

const DEVELOPER_FACTS = normalizeEvidence([
  claim({ type: 'property.kind', value: 'APARTMENT' }),
  claim({ type: 'property.area', value: '94.1 m²', source: 'tas' }),
  claim({ type: 'ownership.owner' }),
  claim({ type: 'ownership.ownerType', value: 'COMPANY' }),
  claim({ type: 'company.name', value: 'შპს მილენიო გრუპი' }),
  claim({ type: 'company.idCode', value: '404670272' }),
  claim({ type: 'company.shareholder', subject: 'ლევან ჩაჩუა', value: '50%' }),
  claim({ type: 'company.shareholder', subject: 'კობა კვანტალიანი', value: '50%' }),
  claim({ type: 'company.director', subject: 'ლევან ჩაჩუა', value: 'ერთობლივი' }),
  claim({ type: 'construction.status', value: 'მშენებარე', source: 'tas' }),
  claim({ type: 'encumbrance.mortgage', value: 'საქართველოს ბანკი' }),
  claim({ type: 'encumbrance.seizure', value: false, negative: true }),
  claim({ type: 'location.street', value: 'კრწანისის ქუჩა N6', source: 'tas' }),
]);

/* ------------------------------------------------------------------ *
 * Grounding.                                                          *
 * ------------------------------------------------------------------ */

test('EVERY point in the plan carries evidence — NO EVIDENCE = NO FACT', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  for (const s of plan.sections) {
    for (const p of s.points) {
      assert.equal(p.evidence.length > 0, true, `${p.key} has no evidence`);
    }
  }
});

test('no evidence produces no fact sections at all', () => {
  const plan = buildSynthesisPlan([], 'DEVELOPER_APARTMENT');
  // Only the narrative scaffolding survives. Even "things worth confirming"
  // is dropped when there is nothing to confirm — an empty section heading is
  // clutter, not information.
  const factSections = plan.sections.filter((s) => !['INTRO', 'ASSESSMENT', 'MEANING', 'NEXT'].includes(s.key));
  assert.deepEqual(factSections, []);
  assert.deepEqual(plan.renderContract.allowedPointKeys, [], 'nothing may be cited');
});

test('the synthesis is ONE pass over all evidence, not per-source summaries', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  // Facts from tas and enreg land in the SAME sections, organised by meaning.
  const ownership = plan.sections.find((s) => s.key === 'OWNERSHIP');
  const sources = new Set(ownership.points.flatMap((p) => p.evidence.map((e) => e.source)));
  assert.equal(ownership.points.length > 1, true);
  assert.equal(sources.has('enreg'), true);
  // No section is named after a worker.
  assert.equal(plan.sections.some((s) => /enreg|tas|rstax|worker/i.test(s.key)), false);
});

/* ------------------------------------------------------------------ *
 * Adaptive structure.                                                 *
 * ------------------------------------------------------------------ */

test('the report does NOT open with the verdict', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  assert.equal(plan.sections[0].key, 'INTRO');
  const assessmentAt = plan.sections.findIndex((s) => s.key === 'ASSESSMENT');
  assert.equal(assessmentAt > 3, true, 'the assessment comes late, after the story');
});

test('sections adapt to property type', () => {
  const dev = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT').sections.map((s) => s.key);
  assert.equal(dev.includes('COMPANY'), true);
  assert.equal(dev.includes('PEOPLE'), true);

  const landFacts = normalizeEvidence([
    claim({ type: 'land.category', value: 'არასასოფლო', source: 'tas' }),
    claim({ type: 'land.k2', value: '2.1', source: 'tas' }),
  ]);
  const land = buildSynthesisPlan(landFacts, 'LAND').sections.map((s) => s.key);
  assert.equal(land.includes('PERMITS'), true);
  assert.equal(land.includes('COMPANY'), false, 'land has no developer section');
  assert.equal(land.includes('PROFESSIONALS'), false);
});

test('empty sections are dropped rather than shown as blanks', () => {
  const thin = normalizeEvidence([claim({ type: 'ownership.owner' })]);
  const keys = buildSynthesisPlan(thin, 'DEVELOPER_APARTMENT').sections.map((s) => s.key);
  assert.equal(keys.includes('CONSTRUCTION'), false);
  assert.equal(keys.includes('MARKET'), false);
  assert.equal(keys.includes('OWNERSHIP'), true);
});

test('narrative sections always exist so the report can be written', () => {
  const keys = buildSynthesisPlan([], 'UNKNOWN').sections.map((s) => s.key);
  for (const k of ['INTRO', 'ASSESSMENT', 'MEANING', 'NEXT']) assert.equal(keys.includes(k), true);
});

/* ------------------------------------------------------------------ *
 * Conflicts and why-it-matters.                                       *
 * ------------------------------------------------------------------ */

test('a conflict is preserved and surfaced, never merged away', () => {
  const facts = normalizeEvidence([
    claim({ type: 'ownership.owner', value: 'A', source: 'enreg' }),
    claim({ type: 'ownership.owner', value: 'B', source: 'tas' }),
  ]);
  const plan = buildSynthesisPlan(facts, 'PRIVATE_APARTMENT');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].conflict.alternative, 'B');
});

test('facts that matter carry an explanation of WHY', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  const mortgage = plan.sections.flatMap((s) => s.points).find((p) => p.key.startsWith('encumbrance.mortgage'));
  assert.equal(typeof mortgage.matters === 'string' && mortgage.matters.length > 20, true);
});

test('an explicit negative reads as a real finding, not as missing data', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  const seizure = plan.sections.flatMap((s) => s.points).find((p) => p.key.startsWith('encumbrance.seizure'));
  assert.equal(seizure.negative, true);
  assert.match(seizure.statement, /არ არის რეგისტრირებული/);
});

/* ------------------------------------------------------------------ *
 * Verdict is property risk ONLY.                                      *
 * ------------------------------------------------------------------ */

test('a technical failure NEVER moves the verdict', () => {
  const clean = normalizeEvidence([claim({ type: 'ownership.owner' })]);
  const withFailures = normalizeEvidence([
    claim({ type: 'ownership.owner' }),
    claim({ type: 'source.unavailable', value: 'rstax', source: 'system' }),
    claim({ type: 'source.captchaBlocked', value: 'mygov', source: 'system' }),
  ]);
  assert.equal(computeVerdict(clean).verdict, computeVerdict(withFailures).verdict);
  assert.equal(computeVerdict(withFailures).verdict, 'POSITIVE');
});

test('a mortgage alone is moderately positive, a seizure is negative', () => {
  const m = normalizeEvidence([claim({ type: 'encumbrance.mortgage', value: 'ბანკი' })]);
  assert.equal(computeVerdict(m).verdict, 'MODERATELY_POSITIVE');

  const s = normalizeEvidence([claim({ type: 'encumbrance.seizure', value: 'yes' })]);
  assert.equal(computeVerdict(s).verdict, 'NEGATIVE');
});

test('an explicit "not registered" negative does NOT count as risk', () => {
  const facts = normalizeEvidence([claim({ type: 'encumbrance.seizure', value: false, negative: true })]);
  assert.equal(computeVerdict(facts).verdict, 'POSITIVE');
});

test('exactly one verdict from the three allowed values', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  assert.equal(['POSITIVE', 'MODERATELY_POSITIVE', 'NEGATIVE'].includes(plan.verdict), true);
  assert.equal(plan.verdictReasons.length > 0, true);
});

/* ------------------------------------------------------------------ *
 * The rendering gate.                                                 *
 * ------------------------------------------------------------------ */

test('a renderer may only cite points the plan gave it', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  const good = plan.sections
    .filter((s) => s.points.length)
    .map((s) => ({ sectionKey: s.key, text: 'ტექსტი', usedPointKeys: s.points.map((p) => p.key) }));
  assert.equal(validateRendering(plan, good).ok, true);

  const invented = [{ sectionKey: 'OWNERSHIP', text: 'x', usedPointKeys: ['made.up:99'] }];
  const v = validateRendering(plan, invented);
  assert.equal(v.ok, false);
  assert.match(v.problems.join(' '), /ungrounded point cited/);
});

test('internal vocabulary in rendered text is rejected before the customer sees it', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  const leaky = [{ sectionKey: 'OWNERSHIP', text: 'the enreg worker returned CONFIRMED', usedPointKeys: [] }];
  const v = validateRendering(plan, leaky);
  assert.equal(v.ok, false);
  assert.equal(v.problems.length >= 2, true);
});

test('a rendering that drops a conflict is rejected', () => {
  const facts = normalizeEvidence([
    claim({ type: 'ownership.owner', value: 'A', source: 'enreg' }),
    claim({ type: 'ownership.owner', value: 'B', source: 'tas' }),
  ]);
  const plan = buildSynthesisPlan(facts, 'PRIVATE_APARTMENT');
  const v = validateRendering(plan, [{ sectionKey: 'INTRO', text: 'ყველაფერი რიგზეა', usedPointKeys: [] }]);
  assert.equal(v.ok, false);
  assert.match(v.problems.join(' '), /conflict omitted/);
});

test('the render contract states its rules and its allowed points', () => {
  const plan = buildSynthesisPlan(DEVELOPER_FACTS, 'DEVELOPER_APARTMENT');
  assert.equal(plan.renderContract.language, 'ka');
  assert.equal(plan.renderContract.allowedPointKeys.length > 0, true);
  assert.equal(plan.renderContract.rules.some((r) => r.includes('ახალი ფაქტი არ დაამატო')), true);
});

/* ------------------------------------------------------------------ *
 * TRUTHFUL PROGRESS                                                   *
 * ------------------------------------------------------------------ */

test('no fake percentage: percent is null unless genuinely countable', () => {
  const v = buildProgressView({ status: 'RUNNING', results: [], currentSource: 'tas' });
  assert.equal(v.percent, null, 'unknown total means no number');
});

test('percent is completed/planned sources when the total IS known', () => {
  const v = buildProgressView({
    status: 'RUNNING', plannedSources: 4, currentSource: 'enreg',
    results: [
      { source: 'TAS_MAP', resultConfirmed: true },
      { source: 'tas', resultConfirmed: true },
    ],
  });
  assert.equal(v.percent, 50);
});

test('the current activity is customer language, never a stage name', () => {
  const v = buildProgressView({ status: 'RUNNING', results: [], currentSource: 'enreg' });
  assert.equal(v.current.label, 'ვიკვლევთ პროექტსა და კომპანიას...');
  assert.equal(/enreg|stage|FSM/i.test(v.current.label), false);
});

test('milestones come from REAL results, never from a stage counter', () => {
  const none = buildProgressView({ status: 'RUNNING', results: [] });
  assert.deepEqual(none.milestones, []);

  const some = buildProgressView({
    status: 'RUNNING',
    results: [{ source: 'tas', resultConfirmed: true, retrievedAt: '2026-09-09T10:00:00Z' }],
  });
  assert.equal(some.milestones.some((m) => m.key === 'property-identified'), true);
  assert.equal(some.milestones.some((m) => m.key === 'company-identified'), false, 'no company milestone without an enreg result');
});

test('a source that ran but confirmed nothing does not fake a milestone', () => {
  const v = buildProgressView({
    status: 'RUNNING',
    results: [{ source: 'enreg', resultConfirmed: false, status: 'NO_RESULT_CONFIRMED' }],
  });
  assert.equal(v.milestones.some((m) => m.key === 'company-identified'), false);
});

test('human verification overrides ordinary progress', () => {
  // WAITING_HUMAN is the only pause status the pipeline emits; the test
  // previously used WAITING_HUMAN_LOCAL, from the rejected
  // developer-browser design, which nothing ever produces.
  const v = buildProgressView({ status: 'WAITING_HUMAN', results: [], currentSource: 'rstax' });
  assert.equal(v.awaitingHuman, true);
  assert.equal(v.current.key, 'HUMAN_VERIFICATION');
});

test('progressive findings are only confirmed ones', () => {
  const v = buildProgressView({
    status: 'RUNNING',
    results: [
      { source: 'tas', resultConfirmed: true },
      { source: 'enreg', resultConfirmed: false },
    ],
  });
  assert.equal(v.confirmedSoFar.length, 1);
  assert.match(v.confirmedSoFar[0], /ოფიციალურ წყაროში მოიძებნა/);
});

test('a finished job shows no in-flight activity', () => {
  assert.equal(buildProgressView({ status: 'COMPLETE', results: [] }).current, null);
});
