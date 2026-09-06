// entityValidation.test.mjs — entities/EntityValidation.ts's looksLikeCompanyId(),
// the core invariant behind the real production job 08379309-bb2e-4ac6-9d97-
// 727edb3af2b8 ENREG fix ("a company name must NEVER be copied into idCode").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCompanyId } from '../.tstest-build/entities/EntityValidation.js';

test('looksLikeCompanyId: accepts a real 9-11 digit registry id', () => {
  assert.ok(looksLikeCompanyId('404670272'));
  assert.ok(looksLikeCompanyId('405123456'));
});
test('looksLikeCompanyId: rejects a company NAME — the exact production bug value', () => {
  assert.ok(!looksLikeCompanyId('Millenio Group'));
});
test('looksLikeCompanyId: rejects null/undefined/empty', () => {
  assert.ok(!looksLikeCompanyId(null));
  assert.ok(!looksLikeCompanyId(undefined));
  assert.ok(!looksLikeCompanyId(''));
});
test('looksLikeCompanyId: rejects too-short/too-long digit runs', () => {
  assert.ok(!looksLikeCompanyId('12345'));
  assert.ok(!looksLikeCompanyId('123456789012'));
});
