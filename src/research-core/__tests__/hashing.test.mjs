// The digest is written by hand, in TypeScript, because it has to be
// synchronous and has to run in Deno, Node and the browser. That is a
// defensible decision only if the implementation is actually correct, and the
// failure mode if it is not is silent: two different pages would share a
// content hash and be deduped into one.
//
// So it is pinned against the FIPS 180-4 vectors, and against the hash the
// platform itself computes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

import { sha256Hex } from '../core/sha256.ts';
import { contentHash, normalizeForHash, stableHash, stableStringify, shingleFingerprint, hammingDistanceHex } from '../normalize/hash.ts';
import { deterministicId, newId } from '../core/ids.ts';
import { documentFingerprint, profileFingerprint, scopeToken, isResearchCoreFingerprint } from '../bridge/cache-key.ts';

test('the published SHA-256 test vectors', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('it agrees with the platform digest across every padding boundary', () => {
  // 55/56/63/64/65 bytes are where a hand-written padding calculation goes
  // wrong, and where it would go wrong silently.
  for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
    const input = 'x'.repeat(length);
    assert.equal(sha256Hex(input), createHash('sha256').update(input).digest('hex'), `length ${length}`);
  }
});

test('it handles multi-byte UTF-8 the same way the platform does', () => {
  for (const input of ['ბინა თბილისში', '日本語', 'Ωμέγα', '🏠🏢', 'ა'.repeat(200)]) {
    assert.equal(sha256Hex(input), createHash('sha256').update(input, 'utf8').digest('hex'), input.slice(0, 8));
  }
});

test('it agrees with WebCrypto, which is what Deno would use', async () => {
  const bytes = new TextEncoder().encode('homatch research core');
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(sha256Hex('homatch research core'), hex);
});

/* ── Content identity ─────────────────────────────────────────────────── */

test('two pages differing only in ads, casing and whitespace hash the same', () => {
  const a = 'Two-bedroom  APARTMENT in Vake.   Price on request.';
  const b = 'two-bedroom apartment in vake. price on request.';
  assert.equal(contentHash(a), contentHash(b));
});

test('two pages with different prose do NOT hash the same', () => {
  assert.notEqual(
    contentHash('Two-bedroom apartment in Vake'),
    contentHash('Three-bedroom apartment in Vake'),
  );
});

test('non-breaking spaces, which portals emit freely, normalize away', () => {
  assert.equal(normalizeForHash('a b c'), 'a b c');
});

test('stable hashing does not depend on key order', () => {
  assert.equal(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }));
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
  assert.equal(stableStringify({ b: 1, a: undefined }), '{"b":1}');
});

test('the near-duplicate fingerprint is close for near-duplicates and far otherwise', () => {
  const base = 'a spacious two bedroom apartment in vake with a balcony and parking space included';
  const edited = 'a spacious two bedroom apartment in vake with a balcony and parking space provided';
  const other = 'a small studio in gldani on the fourth floor of a panel building without a lift';

  const near = hammingDistanceHex(shingleFingerprint(base), shingleFingerprint(edited));
  const far = hammingDistanceHex(shingleFingerprint(base), shingleFingerprint(other));
  assert.ok(near < far, `near=${near} far=${far}`);
});

/* ── Identifiers ──────────────────────────────────────────────────────── */

test('a deterministic id is the same every time and different for different inputs', () => {
  assert.equal(deterministicId('obs', 'a', 'b'), deterministicId('obs', 'a', 'b'));
  assert.notEqual(deterministicId('obs', 'a', 'b'), deterministicId('obs', 'a', 'c'));
});

test('joined parts cannot be confused with each other', () => {
  // ("ab","c") and ("a","bc") must not produce one id, or two different
  // observations merge.
  assert.notEqual(deterministicId('x', 'ab', 'c'), deterministicId('x', 'a', 'bc'));
});

test('a random id is unique across a large batch', () => {
  const ids = new Set(Array.from({ length: 5000 }, () => newId('job')));
  assert.equal(ids.size, 5000);
});

/* ── Cache keys ───────────────────────────────────────────────────────── */

test('a core fingerprint can never be confused with an existing one', () => {
  // homatch-research writes a bare 64-hex SHA-256. Redefining any existing key
  // would invalidate the whole cache at once — a real cost event.
  const key = documentFingerprint({
    url: 'https://p.test/a',
    canonicalization: {},
    provider: 'p',
    context: { visibilityScope: 'PUBLIC_GLOBAL' },
    visibility: 'PUBLIC',
  });
  assert.ok(isResearchCoreFingerprint(key));
  assert.ok(!/^[0-9a-f]{64}$/.test(key), 'the key looks like an existing fingerprint');
  assert.ok(!isResearchCoreFingerprint('a'.repeat(64)));
});

test('the same request produces the same key, a different one does not', () => {
  const base = {
    url: 'https://p.test/a',
    canonicalization: {},
    provider: 'p',
    context: { visibilityScope: 'PUBLIC_GLOBAL' },
    visibility: 'PUBLIC',
  };
  assert.equal(documentFingerprint(base), documentFingerprint(base));
  assert.notEqual(documentFingerprint(base), documentFingerprint({ ...base, url: 'https://p.test/b' }));
  assert.notEqual(documentFingerprint(base), documentFingerprint({ ...base, provider: 'q' }));
  assert.notEqual(
    documentFingerprint(base),
    documentFingerprint({ ...base, variant: { lang: 'ka' } }),
  );
});

test('variant key material is order-independent', () => {
  const base = {
    url: 'https://p.test/a',
    canonicalization: {},
    provider: 'p',
    context: { visibilityScope: 'PUBLIC_GLOBAL' },
    visibility: 'PUBLIC',
  };
  assert.equal(
    documentFingerprint({ ...base, variant: { a: 1, b: 2 } }),
    documentFingerprint({ ...base, variant: { b: 2, a: 1 } }),
  );
});

test('a tenant id never appears in a key that might be logged', () => {
  const token = scopeToken({ visibilityScope: 'TENANT_PRIVATE', tenantId: 'acme-corp' }, 'PRIVATE');
  assert.ok(!token.includes('acme-corp'));
  assert.match(token, /^tenant:[0-9a-f]{16}$/);
});

test('a private scope with no identity is isolated, not made public', () => {
  const orphan = scopeToken({ visibilityScope: 'TENANT_PRIVATE' }, 'PRIVATE');
  assert.equal(orphan, 'tenant:orphan');
  assert.notEqual(orphan, 'public');
});

test('a public source in a public request is cached globally', () => {
  assert.equal(scopeToken({ visibilityScope: 'PUBLIC_GLOBAL' }, 'PUBLIC'), 'public');
});

test('a profile key separates profiles and subjects', () => {
  const base = {
    profileId: 'MARKET_COMPARABLES',
    subject: '01.18.06.019.055',
    provider: 'core',
    context: { visibilityScope: 'PUBLIC_GLOBAL' },
    visibility: 'PUBLIC',
  };
  assert.equal(profileFingerprint(base), profileFingerprint({ ...base, subject: ' 01.18.06.019.055 ' }));
  assert.notEqual(profileFingerprint(base), profileFingerprint({ ...base, profileId: 'INVESTMENT_RENT_CHECK' }));
});
