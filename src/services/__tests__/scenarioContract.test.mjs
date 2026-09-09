import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioName, normalizePricing } from '../scenarioContract.ts';

/*
 * These are the client half of a contract the DATABASE also enforces:
 *
 *   renovation_scenarios.name           NOT NULL
 *   renovation_scenarios_priced_iff_version_ck
 *       PRICED  <=>  price_book_version_id IS NOT NULL
 *
 * The original defect was exactly this contract being unmet: saveScenario()
 * sent `name: null` and never sent a version at all, so every save would have
 * failed with a not-null violation. These tests exist so that cannot regress
 * silently between here and the constraint.
 */

/* ---------------------------------------------------------------- *
 * name is NEVER null                                                *
 * ---------------------------------------------------------------- */

test('a typed name is used as-is', () => {
  assert.equal(scenarioName('Kitchen first', { area: 70, level: 'STANDARD' }), 'Kitchen first');
});

test('surrounding whitespace is trimmed rather than stored', () => {
  assert.equal(scenarioName('   Premium bath   ', {}), 'Premium bath');
});

test('an empty, blank, null or undefined name still yields a usable label', () => {
  for (const typed of ['', '   ', null, undefined]) {
    const n = scenarioName(typed, { area: 94.1, level: 'UPPER_STANDARD' });
    assert.ok(typeof n === 'string' && n.length > 0, `got ${JSON.stringify(n)}`);
    assert.match(n, /94 m2/);
    assert.match(n, /upper standard/);
  }
});

test('with no inputs at all it still returns a non-empty name', () => {
  // NOT NULL means NOT NULL: there is no input that produces null.
  for (const inputs of [{}, { area: 0 }, { area: NaN }, { level: '' }, { area: -5 }]) {
    const n = scenarioName('', inputs);
    assert.ok(n.length > 0, JSON.stringify(inputs));
  }
  assert.equal(scenarioName('', {}), 'Renovation scenario');
});

test('a very long typed name is bounded rather than rejected', () => {
  const n = scenarioName('x'.repeat(500), {});
  assert.ok(n.length <= 120);
  assert.ok(n.length > 0);
});

/* ---------------------------------------------------------------- *
 * PRICED <=> version, in both directions                            *
 * ---------------------------------------------------------------- */

test('PRICED with a version is preserved', () => {
  assert.deepEqual(normalizePricing('PRICED', 'ver-1'), {
    estimateState: 'PRICED',
    priceBookVersionId: 'ver-1',
  });
});

test('PRICED WITHOUT a version is downgraded, never saved as an unattributable number', () => {
  // This is the direction that matters most: a figure we cannot attribute to
  // an approved price version must not be recorded as a real quote.
  assert.deepEqual(normalizePricing('PRICED', null), {
    estimateState: 'INSUFFICIENT_PRICE_DATA',
    priceBookVersionId: null,
  });
});

test('a non-PRICED state never keeps a version pointer', () => {
  // Otherwise an unpriced scenario could later be misread as having been a
  // real quote against that version.
  for (const state of ['NOT_PRICED', 'INSUFFICIENT_PRICE_DATA']) {
    assert.deepEqual(normalizePricing(state, 'ver-1'), {
      estimateState: state,
      priceBookVersionId: null,
    });
  }
});

test('every output satisfies the database CHECK constraint', () => {
  const states = ['NOT_PRICED', 'PRICED', 'INSUFFICIENT_PRICE_DATA'];
  const versions = [null, 'ver-1'];
  for (const s of states) {
    for (const v of versions) {
      const out = normalizePricing(s, v);
      const priced = out.estimateState === 'PRICED';
      const hasVersion = out.priceBookVersionId !== null;
      assert.equal(
        priced,
        hasVersion,
        `PRICED<=>version violated for input (${s}, ${v}) -> ${JSON.stringify(out)}`
      );
    }
  }
});

test('normalization is idempotent', () => {
  for (const [s, v] of [['PRICED', 'x'], ['PRICED', null], ['NOT_PRICED', 'x'], ['INSUFFICIENT_PRICE_DATA', null]]) {
    const once = normalizePricing(s, v);
    const twice = normalizePricing(once.estimateState, once.priceBookVersionId);
    assert.deepEqual(twice, once);
  }
});
