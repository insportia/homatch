// THE LOCAL GATE: WHAT CAN BE REFUSED WITHOUT ASKING THE DATABASE.
//
// This half of the storage decision sees no rows, so it can never answer
// "is this yours" — and these tests are written to make that boundary
// explicit rather than to pretend otherwise. What it CAN do is refuse
// everything malformed before a signing path is entered, refuse a file type
// or a size a category does not accept, and refuse an anonymous caller from
// a private namespace.
//
// The rule it must never break is that it only ever DENIES: an `allowed:
// true` from here is provisional, and `storageAuth.authorize` still has to
// get an ALLOW out of `storage_authorize` in Postgres before anything is
// signed. The tests at the bottom pin that contract down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { localGate, reasonFromSql } from '../decide.ts';

const ME = '11111111-1111-1111-1111-111111111111';
const ACC = '22222222-2222-2222-2222-222222222222';
const ENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OBJ = '99999999-9999-9999-9999-999999999999';

const yes = async () => true;
const no = async () => false;
const broken = async () => null;

function ask(overrides) {
  return localGate({
    authUid: null,
    isAdmin: () => { throw new Error('is_admin should not have been asked'); },
    ...overrides,
  });
}

// ── Anonymous ────────────────────────────────────────────────────────────

test('an anonymous caller reads only what is genuinely public today', async () => {
  for (const key of ['site-assets/hero.webp', `users/${ACC}/developer-media/${ENT}/${OBJ}`]) {
    const d = await ask({ key, action: 'READ' });
    assert.equal(d.allowed, true, key);
  }
});

test('an anonymous caller is turned away from everything else', async () => {
  const cases = [
    [`users/${ACC}/deal-room-documents/${ENT}/${OBJ}.pdf`, 'READ'],
    [`users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`, 'READ'],
    [`users/${ACC}/generated-reports/${OBJ}.pdf`, 'READ'],
    [`users/${ACC}/mortgage-documents/${ENT}/${OBJ}.pdf`, 'READ'],
    [`users/${ACC}/developer-media/${ENT}/${OBJ}`, 'WRITE'],
    ['site-assets/hero.webp', 'WRITE'],
    ['voice-auditions/take-1.mp3', 'READ'],
    ['diagnostics/selftest/x.txt', 'WRITE'],
    ['system/report.pdf', 'READ'],
    ['research/evidence.png', 'READ'],
  ];
  for (const [key, action] of cases) {
    const d = await ask({ key, action, contentType: 'application/pdf', byteSize: 10 });
    assert.equal(d.allowed, false, `${action} ${key}`);
    assert.equal(d.reason, 'UNAUTHENTICATED', `${action} ${key}`);
  }
});

// ── What this gate deliberately cannot decide ────────────────────────────

test('a signed-in stranger passes the LOCAL gate, because ownership is not local', async () => {
  // This is the boundary, stated as a test: the local half says "maybe" and
  // Postgres says whose object it is. If this ever started returning false
  // on its own, something would be duplicating the ownership rule here.
  const d = await ask({
    key: `users/${ACC}/generated-reports/${OBJ}.pdf`, action: 'READ', authUid: ME,
  });
  assert.equal(d.allowed, true);
  assert.equal(d.parsed.accountId, ACC);
  assert.notEqual(d.parsed.accountId, ME);
});

// ── Admin namespaces ─────────────────────────────────────────────────────

test('admin-only namespaces ask the database and believe the answer', async () => {
  const granted = await ask({
    key: 'voice-auditions/take-1.mp3', action: 'READ', authUid: ME, isAdmin: yes,
  });
  assert.equal(granted.allowed, true);

  for (const key of ['voice-auditions/take-1.mp3', 'diagnostics/x.txt', 'system/x.pdf']) {
    const refused = await ask({ key, action: 'READ', authUid: ME, isAdmin: no });
    assert.equal(refused.allowed, false, key);
    assert.equal(refused.reason, 'NOT_ADMIN', key);
  }
});

test('an unanswerable question is a refusal, never an allow', async () => {
  const d = await ask({
    key: 'voice-auditions/take-1.mp3', action: 'READ', authUid: ME, isAdmin: broken,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'UNAVAILABLE');
});

// ── The content policy, which only this half can enforce ─────────────────

test('a write of the wrong type is refused before anything is signed', async () => {
  const d = await ask({
    key: `users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`,
    action: 'WRITE', authUid: ME, contentType: 'application/x-msdownload', byteSize: 10,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'MIME_NOT_ALLOWED');
});

test('a write that is too large is refused before anything is signed', async () => {
  const d = await ask({
    key: `users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`,
    action: 'WRITE', authUid: ME, contentType: 'image/jpeg', byteSize: 200 * 1024 * 1024,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'TOO_LARGE');
});

test('the content policy applies to writes only, not to reads', async () => {
  const d = await ask({
    key: `users/${ACC}/property-photos/${ENT}/${OBJ}.jpg`, action: 'READ', authUid: ME,
  });
  assert.equal(d.allowed, true);
});

// ── Keys that are not keys ───────────────────────────────────────────────

test('a malformed or unknown key is refused before anything is asked', async () => {
  const cases = [
    `users/${ACC}/generated-reports/../../${OBJ}.pdf`,
    'no-such-namespace/a.pdf',
    `users/not-a-uuid/generated-reports/${OBJ}.pdf`,
    `users/${ACC}/secrets/${OBJ}.pdf`,
    `users/${ACC}/generated-reports/my-tax-return.pdf`,
    '',
    null,
    42,
    { key: 'users' },
  ];
  for (const key of cases) {
    // The throwing isAdmin default proves no database call was attempted.
    const d = await ask({ key, action: 'READ', authUid: ME });
    assert.equal(d.allowed, false, JSON.stringify(key));
    assert.equal(d.reason, 'INVALID_KEY', JSON.stringify(key));
  }
});

// ── The contract with Postgres ───────────────────────────────────────────

test('every verdict Postgres can return maps to a refusal or an allow', () => {
  assert.equal(reasonFromSql('ALLOW'), 'ALLOW');
  for (const v of ['UNAUTHENTICATED', 'NOT_OWNER', 'NOT_ADMIN', 'NO_CAPABILITY', 'INVALID_KEY']) {
    assert.equal(reasonFromSql(v), v);
  }
});

test('anything unrecognised from Postgres is a refusal, including nothing at all', () => {
  // A failed RPC, a renamed verdict, a future word this build has not heard
  // of: all of them deny. There is no "probably fine" in a signing path.
  for (const v of [null, undefined, '', 'YES', 'allow', true, 0, {}, []]) {
    assert.equal(reasonFromSql(v), 'UNAVAILABLE', JSON.stringify(v));
  }
});
