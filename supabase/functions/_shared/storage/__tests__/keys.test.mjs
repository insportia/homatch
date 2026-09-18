// THE AUTHORISATION MAP, PROVEN TO COVER WHAT PRODUCTION ACTUALLY STORES.
//
// Two different failures are guarded here, and they are not the same kind of
// thing:
//
//   1. A key that should be refused is accepted. Traversal, an empty segment,
//      a namespace nobody wrote rules for. Each of these is a way to name an
//      object that a DIFFERENT authorisation decision was made about.
//   2. A bucket exists in the code but not in the map. That one is a
//      time-bomb: the day somebody routes it through R2 there is no rule, so
//      the last test walks the source for `storage.from(...)` and insists on
//      a namespace for every bucket it finds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  NAMESPACES, parseKey, requirementFor, keyForLegacyObject, KeyError,
} from '../keys.ts';

const UID = '11111111-2222-3333-4444-555555555555';
const WS = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('every live bucket has rules, and the diagnostics namespace has no bucket', () => {
  const buckets = Object.values(NAMESPACES).map((r) => r.legacyBucket).filter(Boolean).sort();
  assert.deepEqual(buckets, [
    'deal-room-documents',
    'developer-documents',
    'developer-media',
    'mortgage-offer-documents',
    'property-photos',
    'site-assets',
    'voice-auditions',
  ]);
  // The self-test namespace must never map onto a product bucket, or a proof
  // run could touch a customer object.
  assert.equal(NAMESPACES.diagnostics.legacyBucket, '');
});

test('the map mirrors the live RLS policies, including where they are loose', () => {
  // Owner-scoped in every direction — contracts and mortgage paperwork.
  for (const ns of ['deal-room-documents', 'mortgage-offer-documents']) {
    for (const action of ['READ', 'WRITE', 'DELETE']) {
      assert.equal(NAMESPACES[ns][action].kind, 'OWNER', `${ns}.${action}`);
    }
  }
  // Developer documents: the capability, not ownership.
  assert.deepEqual(NAMESPACES['developer-documents'].READ, { kind: 'WORKSPACE', capability: 'documents' });
  assert.deepEqual(NAMESPACES['developer-media'].WRITE, { kind: 'WORKSPACE', capability: 'inventory' });
  // Loose on purpose, and recorded as such: these two are world-readable in
  // production today and this layer preserves that rather than silently
  // changing who can see live pages.
  assert.equal(NAMESPACES['developer-media'].READ.kind, 'ANYONE');
  assert.equal(NAMESPACES['site-assets'].READ.kind, 'ANYONE');
  // Also loose on purpose: photos_select_own_storage checks only for a session.
  assert.equal(NAMESPACES['property-photos'].READ.kind, 'AUTHENTICATED');
  assert.equal(NAMESPACES['property-photos'].DELETE.kind, 'AUTHENTICATED');
  // Recordings of real people, and the self-test area.
  assert.equal(NAMESPACES['voice-auditions'].READ.kind, 'ADMIN');
  assert.equal(NAMESPACES.diagnostics.WRITE.kind, 'ADMIN');
});

test('a scoped key yields its owner or workspace', () => {
  const owner = parseKey(`deal-room-documents/${UID}/room-9/contract.pdf`);
  assert.equal(owner.namespace, 'deal-room-documents');
  assert.equal(owner.scopeSegment, UID);
  assert.equal(owner.rest, `${UID}/room-9/contract.pdf`);

  const ws = parseKey(`developer-documents/${WS}/permits/a.pdf`);
  assert.equal(ws.scopeSegment, WS);

  const flat = parseKey('site-assets/hero/banner.webp');
  assert.equal(flat.scopeSegment, null);
});

test('keys that could name somebody else’s object are refused', () => {
  const bad = [
    '',
    'deal-room-documents',                                   // namespace only
    `deal-room-documents/${UID}`,                            // scope, no object
    `deal-room-documents/${UID}/../${WS}/contract.pdf`,      // climbs out
    `deal-room-documents/${UID}//contract.pdf`,              // empty segment
    `deal-room-documents/${UID}/./contract.pdf`,             // relative segment
    `/deal-room-documents/${UID}/a.pdf`,                     // absolute
    `deal-room-documents/${UID}/a.pdf/`,                     // trailing
    'deal-room-documents/not-a-uuid/a.pdf',                  // unscoped scope
    'unknown-bucket/a.pdf',                                  // no rules exist
    '__proto__/a.pdf',                                       // prototype, not a namespace
    `site-assets/a\\b.png`,                                  // backslash
  ];
  for (const key of bad) {
    assert.throws(() => parseKey(key), KeyError, `should refuse: ${JSON.stringify(key)}`);
  }
});

test('a key longer than S3 allows is refused here rather than by the service', () => {
  assert.throws(() => parseKey(`site-assets/${'a'.repeat(1100)}`), KeyError);
});

test('requirementFor answers per verb, not per namespace', () => {
  const read = requirementFor('developer-media/' + WS + '/hero.jpg', 'READ');
  const write = requirementFor('developer-media/' + WS + '/hero.jpg', 'WRITE');
  assert.equal(read.requirement.kind, 'ANYONE');
  assert.deepEqual(write.requirement, { kind: 'WORKSPACE', capability: 'inventory' });
  assert.equal(write.parsed.scopeSegment, WS);
});

test('the legacy mapping is the identity with a prefix, so rollback is trivial', () => {
  assert.equal(
    keyForLegacyObject('deal-room-documents', `${UID}/room-9/contract.pdf`),
    `deal-room-documents/${UID}/room-9/contract.pdf`,
  );
  assert.throws(() => keyForLegacyObject('a-bucket-nobody-declared', 'x'), KeyError);
});

// ── The guard that matters in six months ─────────────────────────────────

/** Every `storage.from('<bucket>')` literal in the tree. */
function bucketsReferencedInSource() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/storage\s*\n?\s*\.from\(\s*['"]([a-z0-9-]+)['"]/g)) {
        found.add(m[1]);
      }
    }
  };
  walk('src');
  walk('supabase/functions');
  return found;
}

test('no bucket is used in the code without rules in this map', () => {
  const declared = new Set(
    Object.values(NAMESPACES).map((r) => r.legacyBucket).filter(Boolean),
  );
  const referenced = bucketsReferencedInSource();
  // If this fires, a bucket was introduced without deciding who may read it.
  // Add it to NAMESPACES with the same predicate its RLS policy uses.
  const missing = [...referenced].filter((b) => !declared.has(b)).sort();
  assert.deepEqual(missing, [], `buckets with no authorisation rules: ${missing.join(', ')}`);
  // And the search must actually be finding things, or it proves nothing.
  assert.ok(referenced.size >= 5, `expected to find bucket literals, found ${referenced.size}`);
});
