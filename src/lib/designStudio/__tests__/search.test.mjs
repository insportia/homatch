// Natural words become structured filters — deterministically, in six languages.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAssetQuery, rankAssets } from '../search.ts';
import { testAssets } from './fixtures.mjs';

const assets = [...testAssets().values()];

test('"warm beige sofa" is a category, a colour and a style, not free text', () => {
  const q = parseAssetQuery('warm beige sofa');
  assert.deepEqual(q.categories, ['SOFA']);
  assert.deepEqual(q.colors, ['beige']);
  assert.ok(q.styles.includes('warm-minimal'));
  assert.deepEqual(q.text, []);
});

test('"small wooden table" carries size and material', () => {
  const q = parseAssetQuery('Small wooden table');
  assert.equal(q.size, 'SMALL');
  assert.deepEqual(q.materials, ['wood']);
  assert.deepEqual(q.categories, ['TABLE']);
});

test('core nouns are understood in every product language', () => {
  for (const word of ['დივანი', 'диван', 'kanepe', 'أريكة', 'ספה']) {
    assert.deepEqual(parseAssetQuery(word).categories, ['SOFA'], word);
  }
  assert.deepEqual(parseAssetQuery('საწოლი').categories, ['BED']);
});

test('a category filter excludes; the room kind orders', () => {
  const sofas = rankAssets(assets, parseAssetQuery('sofa'));
  assert.ok(sofas.length >= 3 && sofas.every((a) => a.category === 'SOFA'));
  const small = rankAssets(assets, parseAssetQuery('small sofa'));
  assert.equal(small[0].code, 'dev/sofa-2', 'the smallest sofa should lead a "small" search');
});

test('ranking is deterministic', () => {
  const q = parseAssetQuery('sofa');
  assert.deepEqual(rankAssets(assets, q).map((a) => a.code), rankAssets([...assets].reverse(), q).map((a) => a.code));
});
