import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  marketShape, stripInternalTerms, hasInternalTerms, TIER_LOCALITY, TIER_LABEL_KEY,
} from '../marketNarrative.ts';

/*
 * THE MARKET BLOCK, AGAINST THE REAL STORED NUMBERS.
 *
 * Villion research job 947d921c, read out of production:
 *
 *   SAME_PROJECT 0 · SAME_STREET 0 · SAME_DISTRICT 1 · PEER_PROJECT 37
 *   basis PEER_PROJECT · basisCount 37 · median 1,670
 *
 * Nothing was found in the building or on the street, so the headline figure
 * describes named developments across the city. It is still worth showing —
 * it is just not a measurement of this address, and the report must not imply
 * that it is.
 */

const REAL_MARKET = {
  tierCounts: { SAME_PROJECT: 0, SAME_STREET: 0, SAME_DISTRICT: 1, PEER_PROJECT: 37, WIDER_MARKET: 0 },
  basis: 'PEER_PROJECT',
  basisCount: 37,
  median: 1670,
  count: 38,
};

/* ------------------------------------------------------------------ *
 * Microlocation first                                                 *
 * ------------------------------------------------------------------ */

test('the bands are ordered by how local they are, not by how many they hold', () => {
  assert.deepEqual([...TIER_LOCALITY], [
    'SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT', 'WIDER_MARKET',
  ]);

  const shape = marketShape({
    tierCounts: { SAME_PROJECT: 2, SAME_STREET: 3, SAME_DISTRICT: 9, PEER_PROJECT: 40 },
    basis: 'SAME_PROJECT', basisCount: 2,
  });
  // 40 city listings must never outrank 2 in the same building.
  assert.deepEqual(shape.tiers.map((t) => t.tier), [
    'SAME_PROJECT', 'SAME_STREET', 'SAME_DISTRICT', 'PEER_PROJECT',
  ]);
});

test('empty bands are left out rather than shown as zeroes', () => {
  const shape = marketShape(REAL_MARKET);
  assert.deepEqual(shape.tiers, [
    { tier: 'SAME_DISTRICT', count: 1 },
    { tier: 'PEER_PROJECT', count: 37 },
  ]);
});

/* ------------------------------------------------------------------ *
 * A citywide number must not pose as a local one                      *
 * ------------------------------------------------------------------ */

test('the real report’s headline is correctly judged NOT local', () => {
  const shape = marketShape(REAL_MARKET);
  assert.equal(shape.basis, 'PEER_PROJECT');
  assert.equal(shape.basisCount, 37);
  assert.equal(shape.basisIsLocal, false, '37 listings across the city do not measure this building');
  assert.equal(shape.noLocalEvidence, true);
  assert.equal(shape.headlineKey, 'verify_mkt_frame_citywide');
});

test('a building or street sample IS allowed to headline', () => {
  for (const basis of ['SAME_PROJECT', 'SAME_STREET']) {
    const shape = marketShape({
      tierCounts: { [basis]: 4 }, basis, basisCount: 4,
    });
    assert.equal(shape.basisIsLocal, true, `${basis} is the local market`);
    assert.equal(shape.headlineKey, 'verify_mkt_frame_local');
    assert.equal(shape.noLocalEvidence, false);
  }
});

test('a district-only sample is framed as the surrounding area, not as this building', () => {
  const shape = marketShape({
    tierCounts: { SAME_DISTRICT: 6 }, basis: 'SAME_DISTRICT', basisCount: 6,
  });
  assert.equal(shape.basisIsLocal, false);
  assert.equal(shape.headlineKey, 'verify_mkt_frame_surrounding');
});

test('no listings at all says so, and invents no number', () => {
  const shape = marketShape({ tierCounts: {}, basis: null, basisCount: 0 });
  assert.deepEqual(shape.tiers, []);
  assert.equal(shape.headlineKey, 'verify_mkt_frame_none');
  assert.equal(marketShape(null), null);
});

/* ------------------------------------------------------------------ *
 * The similarity claim nobody earned                                  *
 * ------------------------------------------------------------------ */

test('the band of named developments no longer claims similarity', () => {
  /*
   * scoreComparable assigns PEER_PROJECT to any listing that merely carries a
   * project name, anywhere in the city. The old label „მსგავსი პროექტები"
   * asserted a likeness that was never established.
   */
  assert.equal(TIER_LABEL_KEY.PEER_PROJECT, 'verify_mkt_other_projects');
  assert.notEqual(TIER_LABEL_KEY.PEER_PROJECT, 'verify_mkt_peer_project');
  // Every band still has a label; none was dropped.
  for (const tier of TIER_LOCALITY) {
    assert.ok(TIER_LABEL_KEY[tier], `${tier} has no label`);
  }
});

/* ------------------------------------------------------------------ *
 * Internal vocabulary                                                 *
 * ------------------------------------------------------------------ */

test('the exact sentence in the stored report loses its internal term', () => {
  const stored =
    '37 აქტიური განცხადების peer-project შედარებაში მოთხოვნილი ფასების მედიანა 1,670 აშშ დოლარია კვ.მ-ზე.';
  const out = stripInternalTerms(stored);
  assert.equal(hasInternalTerms(stored), true, 'the stored text really does carry it');
  assert.equal(hasInternalTerms(out), false);
  assert.ok(!out.includes('peer'), out);
  // The sentence must survive as a sentence — the facts are the model's and
  // are not ours to discard along with the vocabulary.
  assert.ok(out.includes('37'), out);
  assert.ok(out.includes('1,670'), out);
  assert.ok(!/\s{2,}/.test(out), `double space left behind: ${out}`);
});

test('every internal term the synthesis can leak is covered', () => {
  for (const term of [
    'peer-project', 'peer project', 'peer projects', 'peer set',
    'comparable universe', 'research lane', 'source family', 'source families',
    'wider-market', 'same-project', 'same-street', 'same-district', 'tier counts',
  ]) {
    assert.equal(hasInternalTerms(`context ${term} context`), true, `not covered: ${term}`);
    assert.equal(
      hasInternalTerms(stripInternalTerms(`context ${term} context`)), false,
      `not stripped: ${term}`
    );
  }
});

test('stripping a whole parenthetical leaves no empty brackets', () => {
  assert.equal(stripInternalTerms('მედიანა 1,670 (peer-project).'), 'მედიანა 1,670.');
  assert.equal(stripInternalTerms('median 1,670 (peer set)'), 'median 1,670');
});

test('ordinary prose is returned untouched', () => {
  const clean = 'იმავე ქუჩაზე ორი განცხადებაა, მედიანა 1,670 აშშ დოლარი კვ.მ-ზე.';
  assert.equal(stripInternalTerms(clean), clean);
  assert.equal(hasInternalTerms(clean), false);
  assert.equal(stripInternalTerms(''), '');
});
