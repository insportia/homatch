// A property whose registry names one owner and whose listing names another is
// not a data-quality problem to be smoothed over. It is the most valuable thing
// the research found, and a pipeline that resolves it silently has destroyed
// its own best output.
//
// So: every competing answer survives, in the result, with who said it. There
// is no `winner` field and no averaging — the tests below assert the absence
// as much as the presence.

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectConflicts, conflictSpread } from '../score/conflicts.ts';
import { money } from '../parse/listing.ts';

let n = 0;
function obs(over = {}) {
  n += 1;
  return {
    id: over.id ?? `o${n}`,
    requestedUrl: 'https://x.test/a',
    fetchUrl: 'https://x.test/a',
    canonicalIdentityUrl: 'https://x.test/a',
    source: {
      sourceKey: over.family ?? 'f',
      sourceFamily: over.family ?? 'f',
      kind: over.kind ?? 'PROPERTY_PORTAL',
    },
    evidenceLevel: over.level ?? 'SAME_PROPERTY',
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

const options = { supportOf };

test('two sources naming different owners produce a conflict that keeps both', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'napr.gov.ge' }), claimKey: 'ownership.owner', value: 'LLC Alpha' },
      { observation: obs({ family: 'myhome.ge' }), claimKey: 'ownership.owner', value: 'LLC Beta' },
    ],
    options,
  );

  assert.equal(conflicts.length, 1);
  const conflict = conflicts[0];
  assert.equal(conflict.alternatives.length, 2);
  const values = conflict.alternatives.map((a) => a.value).sort();
  assert.deepEqual(values, ['LLC Alpha', 'LLC Beta']);
});

test('the conflict object has no field that names a winner', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'a' }), claimKey: 'k', value: 'x' },
      { observation: obs({ family: 'b' }), claimKey: 'k', value: 'y' },
    ],
    options,
  );
  const keys = Object.keys(conflicts[0]);
  for (const forbidden of ['resolved', 'winner', 'chosen', 'value', 'resolution', 'best']) {
    assert.ok(!keys.includes(forbidden), `Conflict exposes "${forbidden}"`);
  }
});

test('an asking price and a transaction price do NOT conflict', () => {
  // They are answers to different questions. Flagging them wastes the
  // customer's attention on the one signal that should never be ignored.
  const conflicts = detectConflicts(
    [
      {
        observation: obs({ family: 'a' }),
        claimKey: 'price',
        value: 200000,
        money: money(200000, 'USD', 'ASKING_SALE_PRICE'),
      },
      {
        observation: obs({ family: 'b' }),
        claimKey: 'price',
        value: 185000,
        money: money(185000, 'USD', 'TRANSACTION_PRICE'),
      },
    ],
    options,
  );
  assert.deepEqual(conflicts, []);
});

test('two asking prices far apart DO conflict', () => {
  const conflicts = detectConflicts(
    [
      {
        observation: obs({ family: 'a' }),
        claimKey: 'price',
        value: 200000,
        money: money(200000, 'USD', 'ASKING_SALE_PRICE'),
      },
      {
        observation: obs({ family: 'b' }),
        claimKey: 'price',
        value: 150000,
        money: money(150000, 'USD', 'ASKING_SALE_PRICE'),
      },
    ],
    options,
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].priceBasis, 'ASKING_SALE_PRICE');
  assert.equal(conflicts[0].code, 'NUMERIC_DISAGREEMENT');
  assert.equal(conflictSpread(conflicts[0]), 50000);
});

test('an unlabelled figure cannot contradict a labelled one', () => {
  const conflicts = detectConflicts(
    [
      {
        observation: obs({ family: 'a' }),
        claimKey: 'price',
        value: 200000,
        money: money(200000, 'USD', 'ASKING_SALE_PRICE'),
      },
      {
        observation: obs({ family: 'b' }),
        claimKey: 'price',
        value: 120000,
        money: money(120000, 'USD', 'UNKNOWN'),
      },
    ],
    options,
  );
  assert.deepEqual(conflicts, []);
});

test('a district median does not contradict a specific unit price', () => {
  const conflicts = detectConflicts(
    [
      {
        observation: obs({ family: 'a', level: 'SAME_PROPERTY' }),
        claimKey: 'price_per_sqm',
        value: 2400,
        money: money(2400, 'USD', 'ASKING_SALE_PRICE'),
      },
      {
        observation: obs({ family: 'b', level: 'DISTRICT' }),
        claimKey: 'price_per_sqm',
        value: 1600,
        money: money(1600, 'USD', 'ASKING_SALE_PRICE'),
      },
    ],
    options,
  );
  assert.deepEqual(conflicts, []);
});

test('numbers within tolerance are the same number quoted twice', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'a' }), claimKey: 'area', value: 60.0 },
      { observation: obs({ family: 'b' }), claimKey: 'area', value: 60.5 },
    ],
    options,
  );
  assert.deepEqual(conflicts, []);
});

test('a well-attested disagreement over a big gap is HIGH severity', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'a' }), claimKey: 'floors', value: 12 },
      { observation: obs({ family: 'b' }), claimKey: 'floors', value: 12 },
      { observation: obs({ family: 'c' }), claimKey: 'floors', value: 20 },
      { observation: obs({ family: 'd' }), claimKey: 'floors', value: 20 },
    ],
    options,
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, 'HIGH');
});

test('a lone outlier against a well-attested value is LOW, not suppressed', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'a' }), claimKey: 'rooms', value: 3 },
      { observation: obs({ family: 'b' }), claimKey: 'rooms', value: 3 },
      { observation: obs({ family: 'c' }), claimKey: 'rooms', value: 3 },
      { observation: obs({ family: 'd' }), claimKey: 'rooms', value: 4 },
    ],
    options,
  );
  assert.equal(conflicts.length, 1, 'the minority view was dropped');
  assert.ok(['LOW', 'MEDIUM'].includes(conflicts[0].severity));
  const minority = conflicts[0].alternatives.find((a) => a.value === 4);
  assert.ok(minority, 'the minority alternative is not in the result');
});

test('alternatives are ordered by support, and support carries both counts', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'a' }), claimKey: 'k', value: 'majority' },
      { observation: obs({ family: 'b' }), claimKey: 'k', value: 'majority' },
      { observation: obs({ family: 'c' }), claimKey: 'k', value: 'minority' },
    ],
    options,
  );
  assert.equal(conflicts[0].alternatives[0].value, 'majority');
  assert.equal(conflicts[0].alternatives[0].support.independentSourceCount, 2);
  assert.equal(conflicts[0].alternatives[0].support.observationCount, 2);
});

test('conflict ids are deterministic across runs', () => {
  const build = () =>
    detectConflicts(
      [
        { observation: obs({ id: 'fixed-a', family: 'a' }), claimKey: 'k', value: 'x' },
        { observation: obs({ id: 'fixed-b', family: 'b' }), claimKey: 'k', value: 'y' },
      ],
      options,
    );
  assert.equal(build()[0].id, build()[0].id);
});

test('agreement produces no conflict at all', () => {
  const conflicts = detectConflicts(
    [
      { observation: obs({ family: 'a' }), claimKey: 'k', value: 'same' },
      { observation: obs({ family: 'b' }), claimKey: 'k', value: 'SAME' },
    ],
    options,
  );
  assert.deepEqual(conflicts, []);
});
