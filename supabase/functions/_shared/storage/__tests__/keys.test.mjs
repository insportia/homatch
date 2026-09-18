// THE KEY NAMESPACE, AND THE THINGS A KEY MUST NEVER BE ABLE TO SAY.
//
// Three failures are guarded here, and they are not the same kind of thing:
//
//   1. A key that should be refused is accepted. Traversal, an empty
//      segment, a category nobody wrote rules for, a filename where a uuid
//      belongs. Each is a way of naming an object that a DIFFERENT
//      authorisation decision was made about.
//   2. A person's name or file name ends up in a path. Keys travel: into
//      logs, into a Cloudflare dashboard, into a URL somebody pastes. The
//      key carries uuids and the display name stays in the metadata row.
//   3. A bucket exists in the code but not in the map — a time bomb, because
//      the day it is routed through R2 there is no rule for it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_CATEGORIES, KeyError, NAMESPACES, accountKey, checkContent,
  keyForLegacyObject, parseKey, requirementFor,
} from '../keys.ts';

const ACC = '11111111-2222-3333-4444-555555555555';
const ENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OBJ = '99999999-8888-7777-6666-555555555555';

// ── The account-scoped shape ─────────────────────────────────────────────

test('an account-scoped key parses into account, category and entity', () => {
  const p = parseKey(`users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`);
  assert.equal(p.namespace, 'users');
  assert.equal(p.accountId, ACC);
  assert.equal(p.category, 'property-photos');
  assert.equal(p.entityId, ENT);
  assert.equal(p.entityType, 'property');
});

test('a category with no entity level parses without one', () => {
  const p = parseKey(`users/${ACC}/generated-reports/${OBJ}.pdf`);
  assert.equal(p.category, 'generated-reports');
  assert.equal(p.entityId, null);
});

test('accountKey builds the key, and the FILENAME IS NEVER IN IT', () => {
  const key = accountKey({
    accountId: ACC, category: 'deal-room-documents', entityId: ENT,
    objectId: OBJ, contentType: 'application/pdf',
  });
  assert.equal(key, `users/${ACC}/deal-room-documents/${ENT}/${OBJ}.pdf`);
  // The extension comes from the declared type, not from what the person
  // called the file. Nothing a human typed reaches the path.
  const heic = accountKey({
    accountId: ACC, category: 'property-photos', entityId: ENT,
    objectId: OBJ, contentType: 'image/heic',
  });
  assert.ok(heic.endsWith('.heic'));
  const unknown = accountKey({
    accountId: ACC, category: 'generated-reports', objectId: OBJ,
    contentType: 'application/x-not-a-thing',
  });
  assert.equal(unknown, `users/${ACC}/generated-reports/${OBJ}`);
});

test('accountKey refuses what would make an unsafe path', () => {
  const base = { accountId: ACC, category: 'generated-reports', objectId: OBJ };
  assert.throws(() => accountKey({ ...base, category: 'secrets' }), KeyError);
  assert.throws(() => accountKey({ ...base, accountId: 'me' }), KeyError);
  assert.throws(() => accountKey({ ...base, objectId: 'passport.pdf' }), KeyError);
  // A category that needs an entity cannot be built without one.
  assert.throws(
    () => accountKey({ accountId: ACC, category: 'property-photos', objectId: OBJ }),
    KeyError,
  );
});

test('an object segment that is not a uuid is refused', () => {
  // This is the check that keeps `passport-scan.pdf` out of the key.
  assert.throws(
    () => parseKey(`users/${ACC}/generated-reports/annual-report-2026.pdf`), KeyError,
  );
  assert.throws(
    () => parseKey(`users/${ACC}/property-photos/${ENT}/nino-and-the-house.jpg`), KeyError,
  );
});

test('account-scoped keys have a fixed depth, so nothing extra can be smuggled', () => {
  assert.throws(() => parseKey(`users/${ACC}/generated-reports/${ENT}/${OBJ}.pdf`), KeyError);
  assert.throws(() => parseKey(`users/${ACC}/property-photos/${OBJ}.jpg`), KeyError);
  assert.throws(() => parseKey(`users/${ACC}/property-photos/${ENT}/x/${OBJ}.jpg`), KeyError);
});

test('an unknown account category is refused, prototype keys included', () => {
  for (const bad of ['secrets', '__proto__', 'constructor', '']) {
    assert.throws(() => parseKey(`users/${ACC}/${bad}/${OBJ}.pdf`), KeyError, bad);
  }
});

test('keys that could name somebody else’s object are refused', () => {
  const bad = [
    '',
    'users',
    `users/${ACC}`,
    `users/${ACC}/generated-reports`,
    `users/not-a-uuid/generated-reports/${OBJ}.pdf`,
    `users/${ACC}/generated-reports/../../${OBJ}.pdf`,
    `users/${ACC}//generated-reports/${OBJ}.pdf`,
    `users/${ACC}/./generated-reports/${OBJ}.pdf`,
    `/users/${ACC}/generated-reports/${OBJ}.pdf`,
    `users/${ACC}/generated-reports/${OBJ}.pdf/`,
    `users/${ACC}/generated-reports/a\\b.pdf`,
    'unknown-namespace/a.pdf',
    '__proto__/a.pdf',
  ];
  for (const key of bad) {
    assert.throws(() => parseKey(key), KeyError, `should refuse: ${JSON.stringify(key)}`);
  }
});

test('a key longer than S3 allows is refused here rather than by the service', () => {
  assert.throws(() => parseKey(`site-assets/${'a'.repeat(1100)}`), KeyError);
});

// ── The legacy shapes, kept so a migrated object keeps its path ──────────

test('legacy namespaces still parse, which is what makes the copy a copy', () => {
  const p = parseKey(`deal-room-documents/${ACC}/room/contract.pdf`);
  assert.equal(p.namespace, 'deal-room-documents');
  assert.equal(p.rest, `${ACC}/room/contract.pdf`);
  assert.equal(p.accountId, null);
  assert.equal(
    keyForLegacyObject('voice-auditions', 'batch/take.mp3'),
    'voice-auditions/batch/take.mp3',
  );
  assert.throws(() => keyForLegacyObject('a-bucket-nobody-declared', 'x'), KeyError);
});

test('every live bucket has a namespace, and the system ones have no bucket', () => {
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
  for (const ns of ['users', 'system', 'research', 'diagnostics']) {
    assert.equal(NAMESPACES[ns].legacyBucket, '', ns);
  }
});

// ── The coarse gate ──────────────────────────────────────────────────────

test('the coarse requirement comes from the category when there is one', () => {
  const media = parseKey(`users/${ACC}/developer-media/${ENT}/${OBJ}`);
  assert.equal(requirementFor(media, 'READ').kind, 'ANYONE');
  assert.equal(requirementFor(media, 'WRITE').kind, 'AUTHENTICATED');

  const audition = parseKey('voice-auditions/batch/take.mp3');
  assert.equal(requirementFor(audition, 'READ').kind, 'ADMIN');

  const asset = parseKey('site-assets/hero.webp');
  assert.equal(requirementFor(asset, 'READ').kind, 'ANYONE');
  assert.equal(requirementFor(asset, 'WRITE').kind, 'ADMIN');
});

// ── The content policy ───────────────────────────────────────────────────

test('a photo namespace takes images and nothing else', () => {
  const photo = parseKey(`users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`);
  assert.equal(checkContent(photo, 'image/jpeg', 1024).ok, true);
  assert.equal(checkContent(photo, 'image/heic', 1024).ok, true);
  // A PDF in the photo namespace, and an executable pretending to be one.
  assert.equal(checkContent(photo, 'application/pdf', 1024).reason, 'MIME_NOT_ALLOWED');
  assert.equal(checkContent(photo, 'text/html', 1024).reason, 'MIME_NOT_ALLOWED');
  assert.equal(checkContent(photo, 'application/x-msdownload', 1).reason, 'MIME_NOT_ALLOWED');
  // And no type at all is not a pass.
  assert.equal(checkContent(photo, undefined, 1024).reason, 'MIME_REQUIRED');
  assert.equal(checkContent(photo, '', 1024).reason, 'MIME_REQUIRED');
});

test('a document namespace takes documents and photographs of documents', () => {
  const doc = parseKey(`users/${ACC}/deal-room-documents/${ENT}/${OBJ}.pdf`);
  assert.equal(checkContent(doc, 'application/pdf', 1024).ok, true);
  assert.equal(checkContent(doc, 'image/jpeg', 1024).ok, true);
  assert.equal(checkContent(doc, 'video/mp4', 1024).reason, 'MIME_NOT_ALLOWED');
  // A charset parameter must not defeat the comparison.
  assert.equal(checkContent(doc, 'text/plain; charset=utf-8', 10).ok, true);
});

test('size is capped per category, and the cap is enforced before signing', () => {
  const photo = parseKey(`users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`);
  assert.equal(checkContent(photo, 'image/jpeg', 25 * 1024 * 1024).ok, true);
  assert.equal(checkContent(photo, 'image/jpeg', 25 * 1024 * 1024 + 1).reason, 'TOO_LARGE');
  assert.equal(checkContent(photo, 'image/jpeg', -1).reason, 'BAD_SIZE');
  assert.equal(checkContent(photo, 'image/jpeg', Number.NaN).reason, 'BAD_SIZE');
  // Media is allowed to be much larger; a document is not.
  const media = parseKey(`users/${ACC}/developer-media/${ENT}/${OBJ}`);
  assert.equal(checkContent(media, 'video/mp4', 150 * 1024 * 1024).ok, true);
  const doc = parseKey(`users/${ACC}/generated-reports/${OBJ}.pdf`);
  assert.equal(checkContent(doc, 'application/pdf', 150 * 1024 * 1024).reason, 'TOO_LARGE');
});

test('every account category declares a policy and an entity intention', () => {
  for (const [name, rules] of Object.entries(ACCOUNT_CATEGORIES)) {
    assert.ok(rules.content.maxBytes > 0, `${name} has no size cap`);
    assert.ok(rules.content.mime.length > 0, `${name} admits nothing`);
    assert.equal(typeof rules.entityRequired, 'boolean', name);
    if (rules.entityRequired) assert.ok(rules.entityType, `${name} needs an entity type`);
  }
});

// ── The guard that matters in six months ─────────────────────────────────

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
  const missing = [...referenced].filter((b) => !declared.has(b)).sort();
  assert.deepEqual(missing, [], `buckets with no authorisation rules: ${missing.join(', ')}`);
  assert.ok(referenced.size >= 5, `expected to find bucket literals, found ${referenced.size}`);
});
