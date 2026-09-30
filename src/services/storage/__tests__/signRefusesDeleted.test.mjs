// A deleted storage object is never signed again. Found in production
// (2026-09-30): after a Design Studio project was permanently deleted, the
// owner could still obtain a signed READ URL for one of its keys; R2 answered
// 404 because the bytes were gone, but the signer should refuse outright.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync('supabase/functions/storage-sign/index.ts', 'utf8');

test('storage-sign refuses to sign a key whose record is DELETED, before signing', () => {
  const guard = src.indexOf("lifecycle === 'DELETED'");
  const sign = src.indexOf('await signedUrl(');
  assert.ok(guard > 0, 'the DELETED guard exists');
  assert.ok(guard < sign, 'the guard runs before any URL is signed');
  assert.match(src.slice(guard, guard + 200), /json\(\{ error: 'NOT_FOUND' \}, 404\)/, 'it answers not found');
  assert.match(src.slice(src.lastIndexOf("if (op === 'sign' && db)", guard), guard), /\.select\('lifecycle'\)\.eq\('object_key', objectKey\)/,
    'it asks the index about exactly the key being signed');
});
