// The word-level diff behind "what exactly changes" on each contract finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff, diffStats, tokenize } from '../wordDiff.ts';

const rebuild = (segs, side) => segs.filter((s) => s.kind === 'same' || s.kind === side).map((s) => s.text).join('');

test('only the changed word is marked', () => {
  const segs = wordDiff('The buyer pays within 30 days.', 'The buyer pays within 45 days.');
  assert.deepEqual(segs.filter((s) => s.kind !== 'same').map((s) => [s.kind, s.text]), [['del', '30'], ['ins', '45']]);
  assert.deepEqual(diffStats(segs), { removed: 1, added: 1, kept: 5 });
});

test('both texts can be rebuilt from the segments', () => {
  const before = 'გამყიდველი უფლებამოსილია ცალმხრივად შეწყვიტოს ხელშეკრულება.';
  const after = 'გამყიდველი უფლებამოსილია შეწყვიტოს ხელშეკრულება მხოლოდ მყიდველის წერილობითი თანხმობით.';
  const segs = wordDiff(before, after);
  assert.equal(rebuild(segs, 'del'), before);
  assert.equal(rebuild(segs, 'ins'), after);
  assert.ok(segs.some((s) => s.kind === 'del' && s.text.includes('ცალმხრივად')));
  assert.ok(segs.some((s) => s.kind === 'ins' && s.text.includes('თანხმობით')));
});

test('a line break against a space is not a change', () => {
  const segs = wordDiff('pays within\n30 days', 'pays within 30 days');
  assert.deepEqual(segs, [{ kind: 'same', text: 'pays within 30 days' }]);
});

test('Georgian words tokenize whole, punctuation separately', () => {
  assert.deepEqual(tokenize('ვადა, 30 დღე.'), ['ვადა', ',', ' ', '30', ' ', 'დღე', '.']);
});

test('a brand-new clause is all insertion', () => {
  const segs = wordDiff('', 'The Seller pays a penalty for late handover.');
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, 'ins');
});

test('very long texts are reported as replaced, not computed', () => {
  const a = Array.from({ length: 700 }, (_, i) => `a${i}`).join(' ');
  const b = Array.from({ length: 700 }, (_, i) => `b${i}`).join(' ');
  assert.deepEqual(wordDiff(a, b).map((s) => s.kind), ['del', 'ins']);
});
