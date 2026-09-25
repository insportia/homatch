// EIGHT ADAPTERS IS NOT EIGHT SOURCES' WORTH OF INTELLIGENCE.
//
// If ninety per cent of what reaches a customer came from ss.ge, then Homatch
// is ss.ge with extra steps — and that should be visible on an admin screen
// rather than discovered on the morning ss.ge changes its markup.
//
// The number that decides it is not the share. It is incremental unique
// yield: a source returning four hundred listings the others already gave us
// has added four hundred rows and nothing else.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { concentrationOf } from '../discovery/concentration.ts';
import { stripComments } from '../../../scripts/lib/stripComments.mjs';

const row = (adapterId, overrides = {}) => ({
  adapterId,
  entityId: null,
  hasPrice: true,
  hasArea: true,
  quality: 1,
  ...overrides,
});

test('one source with six decorations is visible as one source', () => {
  /*
   * A top share alone hides the difference between "one big and six tiny"
   * and "two evenly matched". Herfindahl separates them: one source is 1.0,
   * four equal sources are 0.25.
   */
  const dominated = concentrationOf([
    ...Array.from({ length: 90 }, (_, i) => row('ss-ge', { entityId: `e${i}` })),
    ...Array.from({ length: 10 }, (_, i) => row('place-ge', { entityId: `p${i}` })),
  ]);
  assert.equal(dominated.topSource, 'ss-ge');
  assert.equal(dominated.topSourceShare, 0.9);
  assert.ok(dominated.herfindahl > 0.8, `herfindahl ${dominated.herfindahl}`);

  const balanced = concentrationOf([
    ...['a', 'b', 'c', 'd'].flatMap((s) =>
      Array.from({ length: 25 }, (_, i) => row(s, { entityId: `${s}${i}` }))),
  ]);
  assert.equal(balanced.topSourceShare, 0.25);
  assert.equal(balanced.herfindahl, 0.25);
});

test('a source that only repeats what others found has no unique yield', () => {
  /*
   * THE NUMBER THAT DECIDES WHETHER A SOURCE EARNS ITS RATE LIMIT.
   *
   * Both sources here reached the same three properties. Dropping either one
   * loses nothing, and the share figures alone would show two healthy
   * contributors at 50% each.
   */
  const duplicated = concentrationOf([
    row('ss-ge', { entityId: 'e1' }),
    row('ss-ge', { entityId: 'e2' }),
    row('ss-ge', { entityId: 'e3' }),
    row('place-ge', { entityId: 'e1' }),
    row('place-ge', { entityId: 'e2' }),
    row('place-ge', { entityId: 'e3' }),
  ]);

  for (const share of duplicated.shares) {
    assert.equal(share.shareOfHeld, 0.5, 'the shares look balanced');
    assert.equal(share.entitiesTouched, 3);
    assert.equal(
      share.incrementalUniqueEntities, 0,
      `${share.adapterId} is credited with unique entities it shares`,
    );
  }
  assert.equal(duplicated.entities, 3, 'six observations of three flats counted as six properties');
});

test('a source nobody else reaches is credited for exactly what it alone has', () => {
  const mixed = concentrationOf([
    row('ss-ge', { entityId: 'shared' }),
    row('place-ge', { entityId: 'shared' }),
    row('place-ge', { entityId: 'only-place' }),
    row('estatemarket-ge', { entityId: 'only-em-1' }),
    row('estatemarket-ge', { entityId: 'only-em-2' }),
  ]);

  const byId = Object.fromEntries(mixed.shares.map((s) => [s.adapterId, s]));
  assert.equal(byId['ss-ge'].incrementalUniqueEntities, 0);
  assert.equal(byId['place-ge'].incrementalUniqueEntities, 1);
  assert.equal(byId['estatemarket-ge'].incrementalUniqueEntities, 2);
  assert.equal(mixed.entities, 4);
});

test('unresolved observations are counted, not hidden', () => {
  /*
   * UNRESOLVED is the resolver's default and most listings are genuinely
   * unique, so this is not a failure count. It is here because a figure
   * climbing towards 100% is the sign resolution has stopped working, and
   * nothing else on this report would show that.
   */
  const report = concentrationOf([
    row('ss-ge', { entityId: 'e1' }),
    row('ss-ge', { entityId: null }),
    row('place-ge', { entityId: null }),
  ]);
  assert.equal(report.unresolvedObservations, 2);
  assert.equal(report.entities, 1);
});

test('a source with rows and no prices is visible as such', () => {
  /*
   * makler.ge parses cleanly and states a price in three unlabelled
   * currencies, so it publishes none this system will read. It contributes
   * observations that no campaign can rank on price, and a report that only
   * counted rows would show it as a healthy contributor.
   */
  const report = concentrationOf([
    row('ss-ge', { entityId: 'e1', hasPrice: true, hasArea: true }),
    row('makler-ge', { entityId: 'e2', hasPrice: false, hasArea: true }),
    row('makler-ge', { entityId: 'e3', hasPrice: false, hasArea: true }),
  ]);
  const makler = report.shares.find((s) => s.adapterId === 'makler-ge');
  assert.equal(makler.observations, 2);
  assert.equal(makler.withPrice, 0);
  assert.equal(makler.withArea, 2);
});

test('nothing in this module reports a coverage percentage', () => {
  /*
   * "We cover 80% of the market" needs a denominator, and nobody knows how
   * many properties are for sale in Tbilisi. Every number here has a
   * denominator that was actually counted, and the share field is NAMED
   * shareOfHeld so a reader cannot mistake one for the other.
   */
  const code = stripComments(
    readFileSync('src/research-core/discovery/concentration.ts', 'utf8'),
  );
  for (const forbidden of [/coverage/i, /marketSize/i, /totalMarket/i, /estimatedTotal/i]) {
    assert.doesNotMatch(code, forbidden, `a market-size notion appeared: ${forbidden}`);
  }
  assert.match(code, /shareOfHeld/, 'the share field was renamed to something less careful');

  const empty = concentrationOf([]);
  assert.equal(empty.observations, 0);
  assert.equal(empty.topSource, null);
  assert.equal(empty.topSourceShare, 0);
  assert.equal(empty.herfindahl, 0);
});
