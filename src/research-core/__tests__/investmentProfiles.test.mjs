// The Investment contracts, and the deterministic verdict on whether a piece
// of research actually answered anything.
//
// The second half matters more than it looks. If the only thing that can say
// whether a research run succeeded is a language model reading the output,
// there is nothing to check the model against, and a confident summary of an
// empty bundle looks exactly like a confident summary of a good one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  INVESTMENT_PROFILES,
  investmentProfileRegistry,
  INVESTMENT_RENT_CHECK,
  INVESTMENT_LIQUIDITY,
  MARKET_COMPARABLES,
} from '../profiles/investment.ts';
import { evaluateCoverage } from '../profiles/coverage.ts';

let n = 0;
function obs(level = 'SAME_PROJECT', family = 'f') {
  n += 1;
  return {
    id: `o${n}`,
    requestedUrl: 'https://p.test/a',
    fetchUrl: 'https://p.test/a',
    canonicalIdentityUrl: `https://p.test/a${n}`,
    source: { sourceKey: family, sourceFamily: family, kind: 'PROPERTY_PORTAL' },
    evidenceLevel: level,
    observedAt: null,
    retrievedAt: '2026-09-18T00:00:00.000Z',
    contentHash: `h${n}`,
    nearDuplicateFingerprint: null,
    structuredSourceId: null,
    payload: {},
    fieldOrigins: {},
    supportingText: 'text',
  };
}

const supportOf = (observations) => {
  const families = new Set(observations.map((o) => o.source.sourceFamily));
  return {
    observationCount: observations.length,
    independentSourceCount: families.size,
    effectiveSourceCount: families.size,
    familyCounts: {},
  };
};

/* ── The contracts ────────────────────────────────────────────────────── */

test('all six named Investment profiles exist', () => {
  const ids = INVESTMENT_PROFILES.map((p) => p.id).sort();
  assert.deepEqual(ids, [
    'INVESTMENT_DEEP_RESEARCH',
    'INVESTMENT_LIQUIDITY',
    'INVESTMENT_MARKET_MOVEMENT',
    'INVESTMENT_PRICE_CHECK',
    'INVESTMENT_RENT_CHECK',
    'MARKET_COMPARABLES',
  ]);
});

test('every profile is useful without AI', () => {
  // AI is downstream interpretation, not the research authority.
  for (const profile of INVESTMENT_PROFILES) {
    assert.equal(profile.usefulWithoutAi, true, profile.id);
  }
});

test('no objective accepts both an asking basis and an achieved basis', () => {
  // Accepting both is the same as converting between them.
  const askingRent = 'ASKING_RENT';
  const achievedRent = 'ACHIEVED_RENT';
  const asking = 'ASKING_SALE_PRICE';
  const transaction = 'TRANSACTION_PRICE';

  for (const profile of INVESTMENT_PROFILES) {
    for (const objective of profile.objectives) {
      const bases = objective.acceptedPriceBases;
      assert.ok(
        !(bases.includes(askingRent) && bases.includes(achievedRent)),
        `${profile.id}/${objective.id} accepts both asking and achieved rent`,
      );
      assert.ok(
        !(bases.includes(asking) && bases.includes(transaction)),
        `${profile.id}/${objective.id} accepts both asking and transaction price`,
      );
      assert.ok(
        !bases.includes('UNKNOWN'),
        `${profile.id}/${objective.id} accepts UNKNOWN as an answer`,
      );
    }
  }
});

test('every money objective names at least one basis and every gate is real', () => {
  for (const profile of INVESTMENT_PROFILES) {
    for (const objective of profile.objectives) {
      assert.ok(objective.gate.minIndependentSources >= 1, `${objective.id} gate`);
      assert.ok(objective.gate.minObservations >= 1, `${objective.id} gate`);
      assert.ok(objective.preferredLevels.length > 0, `${objective.id} levels`);
      assert.ok(objective.notes.length > 20, `${objective.id} has no explanation`);
    }
  }
});

test('days on market is declared permanently unavailable, with a reason', () => {
  const objective = INVESTMENT_LIQUIDITY.objectives.find((o) => o.id === 'liquidity.days_on_market');
  assert.ok(objective);
  assert.equal(objective.knownUnavailable.reason, 'SOURCE_DOES_NOT_PUBLISH_IT');
  assert.match(objective.knownUnavailable.note, /crawler/i);
});

test('achieved rent and transaction price are declared unavailable too', () => {
  const achieved = INVESTMENT_RENT_CHECK.objectives.find((o) => o.id === 'rent.achieved');
  assert.equal(achieved.knownUnavailable.reason, 'SOURCE_DOES_NOT_PUBLISH_IT');

  const transaction = MARKET_COMPARABLES.objectives.find((o) => o.id === 'comparables.transaction');
  assert.equal(transaction.knownUnavailable.reason, 'SOURCE_DOES_NOT_PUBLISH_IT');
});

test('the subject price objective refuses anything but SAME_PROPERTY', () => {
  const registry = investmentProfileRegistry();
  const objective = registry
    .require('INVESTMENT_PRICE_CHECK')
    .objectives.find((o) => o.id === 'price_check.subject_asking');
  assert.equal(objective.gate.maxEvidenceLevel, 'SAME_PROPERTY');
});

test('deep research runs on BACKGROUND, never in an interactive slot', () => {
  const deep = investmentProfileRegistry().require('INVESTMENT_DEEP_RESEARCH');
  assert.equal(deep.defaultWorkClass, 'BACKGROUND');
  assert.ok(deep.limits.hardDeadlineMs > 60_000);
});

test('no profile bills against a product code that this repo has not defined', () => {
  // The codes exist so a future pricing migration has something to match. This
  // asserts we have NOT quietly started billing against one: creating a
  // billable_products row is a pricing decision and belongs in SQL.
  const registry = investmentProfileRegistry();
  const codes = registry.productCodes();
  assert.ok(codes.length > 0);

  const migrations = join(process.cwd(), 'supabase', 'migrations');
  const sql = readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(migrations, f), 'utf8'))
    .join('\n');

  for (const code of codes) {
    assert.ok(
      !sql.includes(`'${code}'`),
      `${code} already appears in a migration — this pass must not create product rows`,
    );
  }
});

/* ── Coverage ─────────────────────────────────────────────────────────── */

test('an objective with no evidence is UNAVAILABLE, not empty-but-fine', () => {
  const coverage = evaluateCoverage(MARKET_COMPARABLES, [], { supportOf });
  assert.equal(coverage.status, 'NO_EVIDENCE');
  assert.equal(coverage.establishedCount, 0);
  for (const outcome of coverage.objectives) {
    assert.equal(outcome.status, 'UNAVAILABLE');
    assert.ok(outcome.unavailableReason);
  }
});

test('an asking rent offered toward the achieved-rent objective is refused', () => {
  // The single most important assertion in this file.
  const coverage = evaluateCoverage(
    INVESTMENT_RENT_CHECK,
    [
      { objectiveId: 'rent.achieved', observation: obs('SAME_PROJECT', 'a'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.achieved', observation: obs('SAME_PROJECT', 'b'), priceBasis: 'ASKING_RENT' },
    ],
    { supportOf },
  );
  const achieved = coverage.objectives.find((o) => o.objectiveId === 'rent.achieved');
  assert.equal(achieved.status, 'UNAVAILABLE');
  assert.equal(achieved.unavailableReason, 'WRONG_PRICE_BASIS');
  assert.equal(achieved.priceBasis, null);
});

test('enough evidence on the right basis ESTABLISHES an objective', () => {
  const coverage = evaluateCoverage(
    INVESTMENT_RENT_CHECK,
    [
      { objectiveId: 'rent.asking', observation: obs('SAME_PROJECT', 'a'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('SAME_PROJECT', 'b'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('SAME_PROJECT', 'c'), priceBasis: 'ASKING_RENT' },
    ],
    { supportOf },
  );
  const asking = coverage.objectives.find((o) => o.objectiveId === 'rent.asking');
  assert.equal(asking.status, 'ESTABLISHED');
  assert.equal(asking.priceBasis, 'ASKING_RENT');
  assert.equal(asking.achievedLevel, 'SAME_PROJECT');
  assert.equal(coverage.status, 'COMPLETE');
});

test('evidence from one publisher only is PARTIAL, never ESTABLISHED', () => {
  const coverage = evaluateCoverage(
    INVESTMENT_RENT_CHECK,
    [
      { objectiveId: 'rent.asking', observation: obs('SAME_PROJECT', 'only'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('SAME_PROJECT', 'only'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('SAME_PROJECT', 'only'), priceBasis: 'ASKING_RENT' },
    ],
    { supportOf },
  );
  const asking = coverage.objectives.find((o) => o.objectiveId === 'rent.asking');
  assert.equal(asking.status, 'PARTIAL');
  assert.equal(asking.support.independentSourceCount, 1);
  assert.equal(asking.support.observationCount, 3);
});

test('evidence further away than the gate allows does not satisfy it', () => {
  const coverage = evaluateCoverage(
    INVESTMENT_RENT_CHECK,
    [
      { objectiveId: 'rent.asking', observation: obs('BROADER_MARKET', 'a'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('BROADER_MARKET', 'b'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('BROADER_MARKET', 'c'), priceBasis: 'ASKING_RENT' },
    ],
    { supportOf },
  );
  const asking = coverage.objectives.find((o) => o.objectiveId === 'rent.asking');
  assert.equal(asking.status, 'UNAVAILABLE');
  assert.equal(asking.unavailableReason, 'NO_EVIDENCE_AT_REQUIRED_LEVEL');
});

test('the achieved level reported is the FURTHEST one used, not the closest', () => {
  const coverage = evaluateCoverage(
    INVESTMENT_RENT_CHECK,
    [
      { objectiveId: 'rent.asking', observation: obs('SAME_BUILDING', 'a'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('MICRO_LOCATION', 'b'), priceBasis: 'ASKING_RENT' },
      { objectiveId: 'rent.asking', observation: obs('MICRO_LOCATION', 'c'), priceBasis: 'ASKING_RENT' },
    ],
    { supportOf },
  );
  const asking = coverage.objectives.find((o) => o.objectiveId === 'rent.asking');
  assert.equal(asking.achievedLevel, 'MICRO_LOCATION');
});

test('a permanently-unavailable objective IS answered when a source actually states it', () => {
  // The flag suppresses derivation and spending, not reporting. If somebody
  // publishes days-on-market tomorrow, we report it.
  const coverage = evaluateCoverage(
    INVESTMENT_LIQUIDITY,
    [
      { objectiveId: 'liquidity.days_on_market', observation: obs('SAME_PROJECT', 'a'), priceBasis: null },
      { objectiveId: 'liquidity.days_on_market', observation: obs('SAME_PROJECT', 'b'), priceBasis: null },
      { objectiveId: 'liquidity.days_on_market', observation: obs('SAME_PROJECT', 'c'), priceBasis: null },
      { objectiveId: 'liquidity.days_on_market', observation: obs('SAME_PROJECT', 'd'), priceBasis: null },
      { objectiveId: 'liquidity.days_on_market', observation: obs('SAME_PROJECT', 'e'), priceBasis: null },
    ],
    { supportOf },
  );
  const dom = coverage.objectives.find((o) => o.objectiveId === 'liquidity.days_on_market');
  assert.equal(dom.status, 'ESTABLISHED');
});

test('stopping early reports PARTIAL and says which kind of early', () => {
  const coverage = evaluateCoverage(MARKET_COMPARABLES, [], {
    supportOf,
    stoppedEarly: { reason: 'DEADLINE_REACHED' },
  });
  assert.equal(coverage.status, 'PARTIAL');
  const first = coverage.objectives.find((o) => !o.note);
  assert.equal(first.unavailableReason, 'DEADLINE_REACHED');
});

test('two accepted bases present produce ONE outcome on ONE basis, not a blend', () => {
  const coverage = evaluateCoverage(
    investmentProfileRegistry().require('INVESTMENT_PRICE_CHECK'),
    [
      { objectiveId: 'price_check.subject_asking', observation: obs('SAME_PROPERTY', 'a'), priceBasis: 'ASKING_SALE_PRICE' },
      { objectiveId: 'price_check.subject_asking', observation: obs('SAME_PROPERTY', 'b'), priceBasis: 'ASKING_SALE_PRICE' },
      { objectiveId: 'price_check.subject_asking', observation: obs('SAME_PROPERTY', 'c'), priceBasis: 'DEVELOPER_PRICE' },
    ],
    { supportOf },
  );
  const subject = coverage.objectives.find((o) => o.objectiveId === 'price_check.subject_asking');
  assert.equal(subject.priceBasis, 'ASKING_SALE_PRICE');
  assert.equal(subject.support.observationCount, 2, 'the developer price was blended in');
});
