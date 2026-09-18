// THE DECISION THAT REPLACED TWENTY-TWO RLS POLICIES.
//
// A wrong signer is loud: R2 returns 403 and nothing works. A wrong
// authoriser is silent — it hands somebody a working URL to a contract and
// no log anywhere says so. That asymmetry is why every branch is exercised
// here, including the two that only happen when the database is having a bad
// day.
//
// The two database answers are injected, so these run with no Deno, no
// network and no session. What they cannot prove is that `is_admin()` and
// `dev_can()` themselves still mean what they meant — that is a question for
// the database, and the live policies were read from production to build the
// map these tests check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../decide.ts';

const ME = '11111111-1111-1111-1111-111111111111';
const SOMEONE_ELSE = '22222222-2222-2222-2222-222222222222';
const WS = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const yes = async () => true;
const no = async () => false;
const broken = async () => null;

/** Defaults that make every database answer a loud failure unless overridden. */
function ask(overrides) {
  return decide({
    isAdmin: () => { throw new Error('is_admin should not have been asked'); },
    devCan: () => { throw new Error('dev_can should not have been asked'); },
    authUid: null,
    ...overrides,
  });
}

// ── Anonymous ────────────────────────────────────────────────────────────

test('an anonymous caller reads what the live policies let anonymous read', async () => {
  // site_assets_public_read is granted to anon, and developer-media's read
  // policy has no predicate at all. Both buckets are public today.
  for (const key of [`site-assets/hero.webp`, `developer-media/${WS}/tower.jpg`]) {
    const d = await ask({ key, action: 'READ' });
    assert.equal(d.allowed, true, key);
  }
});

test('an anonymous caller is turned away from everything else', async () => {
  const cases = [
    [`deal-room-documents/${ME}/contract.pdf`, 'READ'],
    [`mortgage-offer-documents/${ME}/payslip.pdf`, 'READ'],
    [`property-photos/${ME}/p1/a.jpg`, 'READ'],
    [`developer-documents/${WS}/permit.pdf`, 'READ'],
    [`developer-media/${WS}/tower.jpg`, 'WRITE'],
    ['site-assets/hero.webp', 'WRITE'],
    ['voice-auditions/take-1.webm', 'READ'],
    ['diagnostics/selftest/x.txt', 'WRITE'],
  ];
  for (const [key, action] of cases) {
    const d = await ask({ key, action });
    assert.equal(d.allowed, false, `${action} ${key}`);
    assert.equal(d.reason, 'UNAUTHENTICATED', `${action} ${key}`);
  }
});

// ── Owner-scoped: the contracts and the mortgage paperwork ───────────────

test('an owner reaches their own object and nobody else’s', async () => {
  const mine = await ask({
    key: `deal-room-documents/${ME}/room/contract.pdf`, action: 'READ', authUid: ME,
  });
  assert.equal(mine.allowed, true);

  // The same request, one uuid different. This is the case that matters.
  const theirs = await ask({
    key: `deal-room-documents/${SOMEONE_ELSE}/room/contract.pdf`, action: 'READ', authUid: ME,
  });
  assert.equal(theirs.allowed, false);
  assert.equal(theirs.reason, 'NOT_OWNER');
});

test('ownership holds for writes and deletes too, not just reads', async () => {
  for (const action of ['WRITE', 'DELETE']) {
    const d = await ask({
      key: `mortgage-offer-documents/${SOMEONE_ELSE}/offer.pdf`, action, authUid: ME,
    });
    assert.equal(d.allowed, false, action);
    assert.equal(d.reason, 'NOT_OWNER', action);
  }
});

test('a uuid in a different case is the same uuid', async () => {
  const d = await ask({
    key: `deal-room-documents/${ME.toUpperCase()}/contract.pdf`, action: 'READ', authUid: ME,
  });
  assert.equal(d.allowed, true);
});

// ── Admin ────────────────────────────────────────────────────────────────

test('admin-only namespaces ask the database, and believe the answer', async () => {
  const granted = await ask({
    key: 'voice-auditions/take-1.webm', action: 'READ', authUid: ME, isAdmin: yes,
  });
  assert.equal(granted.allowed, true);

  const refused = await ask({
    key: 'voice-auditions/take-1.webm', action: 'READ', authUid: ME, isAdmin: no,
  });
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, 'NOT_ADMIN');
});

test('a signed-in non-admin cannot touch the diagnostics namespace', async () => {
  for (const action of ['READ', 'WRITE', 'DELETE']) {
    const d = await ask({
      key: 'diagnostics/selftest/x.txt', action, authUid: ME, isAdmin: no,
    });
    assert.equal(d.allowed, false, action);
    assert.equal(d.reason, 'NOT_ADMIN', action);
  }
});

// ── Workspace capability ─────────────────────────────────────────────────

test('developer documents need the capability, asked for that workspace', async () => {
  let asked = null;
  const d = await ask({
    key: `developer-documents/${WS}/permit.pdf`,
    action: 'WRITE',
    authUid: ME,
    devCan: async (workspace, capability) => { asked = { workspace, capability }; return true; },
  });
  assert.equal(d.allowed, true);
  // The workspace put to the database must be the one in the key, not one
  // from the request body.
  assert.deepEqual(asked, { workspace: WS, capability: 'documents' });
});

test('media writes need inventory, not documents', async () => {
  let capability = null;
  await ask({
    key: `developer-media/${WS}/tower.jpg`,
    action: 'WRITE',
    authUid: ME,
    devCan: async (_ws, cap) => { capability = cap; return true; },
  });
  assert.equal(capability, 'inventory');
});

test('a member without the capability is refused', async () => {
  const d = await ask({
    key: `developer-documents/${WS}/permit.pdf`, action: 'READ', authUid: ME, devCan: no,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, 'NO_CAPABILITY');
});

// ── The database is not answering ────────────────────────────────────────

test('an unanswerable question is a refusal, never an allow', async () => {
  const admin = await ask({
    key: 'voice-auditions/take-1.webm', action: 'READ', authUid: ME, isAdmin: broken,
  });
  assert.equal(admin.allowed, false);
  assert.equal(admin.reason, 'UNAVAILABLE');

  const ws = await ask({
    key: `developer-documents/${WS}/permit.pdf`, action: 'READ', authUid: ME, devCan: broken,
  });
  assert.equal(ws.allowed, false);
  assert.equal(ws.reason, 'UNAVAILABLE');
});

// ── Keys that are not keys ───────────────────────────────────────────────

test('a malformed or unknown key is refused before anything is asked', async () => {
  const cases = [
    `deal-room-documents/${ME}/../${SOMEONE_ELSE}/contract.pdf`,
    'no-such-namespace/a.pdf',
    'deal-room-documents/not-a-uuid/a.pdf',
    '',
    null,
    42,
    { key: 'deal-room-documents' },
  ];
  for (const key of cases) {
    // The throwing defaults prove no database call was attempted.
    const d = await ask({ key, action: 'READ', authUid: ME });
    assert.equal(d.allowed, false, JSON.stringify(key));
    assert.equal(d.reason, 'INVALID_KEY', JSON.stringify(key));
  }
});

test('property photos mirror production exactly: a session is the whole check', async () => {
  // Deliberately loose, and loose in the same direction production is.
  // If this test ever has to change, so does who can see existing photos.
  const other = await ask({
    key: `property-photos/${SOMEONE_ELSE}/p1/a.jpg`, action: 'READ', authUid: ME,
  });
  assert.equal(other.allowed, true);
  const anon = await ask({ key: `property-photos/${ME}/p1/a.jpg`, action: 'READ' });
  assert.equal(anon.allowed, false);
  assert.equal(anon.reason, 'UNAUTHENTICATED');
});
