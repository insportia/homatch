// The registry has to get better at its job over time.
//
// The expensive half of discovery is working out where to look. A group that
// produced eleven real leads last month is worth scanning first; one that
// produced four hundred posts and nothing is worth scanning rarely. An engine
// that rediscovers the world every run pays the maximum every time and never
// learns anything.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectSources,
  productivityScore,
  needsRescan,
  shouldBackOff,
  recordScan,
} from '../discovery/source-registry.ts';
import { canSkipOlderThanCursor } from '../discovery/freshness.ts';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

let n = 0;
function source(over = {}) {
  n += 1;
  return {
    id: over.id ?? `src${n}`,
    platform: over.platform ?? 'FACEBOOK',
    sourceType: 'FACEBOOK_GROUP',
    canonicalUrl: over.canonicalUrl ?? `https://www.facebook.com/groups/g${n}/`,
    externalId: null,
    name: over.name ?? `Group ${n}`,
    countryCode: over.countryCode ?? 'GE',
    city: over.city ?? 'Tbilisi',
    region: null,
    languages: over.languages ?? ['ka', 'ru', 'en'],
    compatibleProfiles: over.compatibleProfiles ?? [],
    propertyTerms: over.propertyTerms ?? [],
    accessState: over.accessState ?? 'PUBLIC',
    active: over.active ?? true,
    discoveredAt: ago(120),
    lastScanAt: over.lastScanAt ?? ago(5),
    lastSuccessAt: over.lastSuccessAt ?? ago(5),
    cursor: over.cursor ?? null,
    chronological: over.chronological ?? false,
    failureCount: over.failureCount ?? 0,
    lastFailureReason: null,
    productivity: over.productivity ?? [],
  };
}

const record = (over = {}) => ({
  profileId: 'BUYER_SEARCH',
  countryCode: 'GE',
  language: null,
  scanned: 0,
  useful: 0,
  lastUsefulAt: null,
  lastScanAt: ago(1),
  ...over,
});

/* ── Productivity ─────────────────────────────────────────────────────── */

test('an unproven source sits above hopeless and below proven', () => {
  // The prior is a realistic yield, not a half. A half would put every
  // unproven source above every proven good one, which is exactly backwards.
  const options = { countryCode: 'GE', now: NOW };
  const unproven = productivityScore(source(), 'BUYER_SEARCH', options);
  const hopeless = productivityScore(
    source({ productivity: [record({ scanned: 200, useful: 0 })] }),
    'BUYER_SEARCH', options,
  );
  const proven = productivityScore(
    source({ productivity: [record({ scanned: 200, useful: 60, lastUsefulAt: ago(1) })] }),
    'BUYER_SEARCH', options,
  );

  assert.ok(unproven > hopeless, 'a source proven to produce nothing outranked an untried one');
  assert.ok(proven > unproven, 'an untried source outranked a proven producer');
});

test('a source with a long good record outranks one with a long bad record', () => {
  const good = source({ productivity: [record({ scanned: 200, useful: 60, lastUsefulAt: ago(1) })] });
  const bad = source({ productivity: [record({ scanned: 200, useful: 1, lastUsefulAt: ago(1) })] });
  const options = { countryCode: 'GE', now: NOW };
  assert.ok(
    productivityScore(good, 'BUYER_SEARCH', options) > productivityScore(bad, 'BUYER_SEARCH', options),
  );
});

test('one lucky scan does not score like a proven source', () => {
  // A 1-for-1 source is a 100% yield and means nothing. Shrinkage is what
  // stops it jumping to the top of the queue on the strength of one item.
  const options = { countryCode: 'GE', now: NOW };
  const lucky = productivityScore(
    source({ productivity: [record({ scanned: 1, useful: 1, lastUsefulAt: ago(1) })] }),
    'BUYER_SEARCH', options,
  );
  const proven = productivityScore(
    source({ productivity: [record({ scanned: 300, useful: 90, lastUsefulAt: ago(1) })] }),
    'BUYER_SEARCH', options,
  );

  assert.ok(lucky < 0.25, `a 1-of-1 source scored ${lucky}, close to its raw 100% yield`);
  assert.ok(proven > lucky, 'a single lucky scan outranked a 300-scan record');
});

test('productivity is per job, not per source', () => {
  // The same group is excellent for renters and useless for land.
  const s = source({
    productivity: [
      record({ profileId: 'RENTER_SEARCH', scanned: 100, useful: 40, lastUsefulAt: ago(1) }),
      record({ profileId: 'LAND_SEARCH', scanned: 100, useful: 0, lastUsefulAt: null }),
    ],
  });
  const options = { countryCode: 'GE', now: NOW };
  assert.ok(
    productivityScore(s, 'RENTER_SEARCH', options) > productivityScore(s, 'LAND_SEARCH', options),
  );
});

test('a source that produced well a year ago and nothing since decays', () => {
  const stale = source({ productivity: [record({ scanned: 200, useful: 80, lastUsefulAt: ago(200) })] });
  const fresh = source({ productivity: [record({ scanned: 200, useful: 80, lastUsefulAt: ago(1) })] });
  const options = { countryCode: 'GE', now: NOW };
  assert.ok(
    productivityScore(fresh, 'BUYER_SEARCH', options) > productivityScore(stale, 'BUYER_SEARCH', options),
  );
});

/* ── Selection ────────────────────────────────────────────────────────── */

const select = (sources, over = {}) =>
  selectSources(sources, {
    profileId: 'BUYER_SEARCH',
    countryCode: 'GE',
    limit: 10,
    now: NOW,
    ...over,
  });

test('the best sources are scanned first', () => {
  const weak = source({ id: 'weak', productivity: [record({ scanned: 100, useful: 2, lastUsefulAt: ago(2) })] });
  const strong = source({ id: 'strong', productivity: [record({ scanned: 100, useful: 45, lastUsefulAt: ago(1) })] });
  const outcome = select([weak, strong]);
  assert.equal(outcome.selected[0].id, 'strong');
});

test('a JOIN_REQUIRED source is skipped and recorded, never auto-joined', () => {
  const outcome = select([source({ id: 'private', accessState: 'JOIN_REQUIRED' })]);
  assert.deepEqual(outcome.selected, []);
  assert.equal(outcome.skipped.find((s) => s.id === 'private').reason, 'JOIN_REQUIRED');
});

test('an authenticated source is skipped when no session is connected', () => {
  const s = source({ id: 'needs-auth', accessState: 'AUTHENTICATED_ACCESS' });
  assert.equal(select([s]).skipped.find((x) => x.id === 'needs-auth').reason, 'NO_AUTHENTICATED_SESSION');
  assert.equal(select([s], { authenticatedAvailable: true }).selected.length, 1);
});

test('inactive, inaccessible and wrong-market sources are all skipped with a reason', () => {
  const outcome = select([
    source({ id: 'off', active: false }),
    source({ id: 'gone', accessState: 'INACCESSIBLE' }),
    source({ id: 'elsewhere', countryCode: 'TR' }),
  ]);
  assert.deepEqual(outcome.selected, []);
  const reasons = Object.fromEntries(outcome.skipped.map((s) => [s.id, s.reason]));
  assert.equal(reasons.off, 'INACTIVE');
  assert.equal(reasons.gone, 'INACCESSIBLE');
  assert.equal(reasons.elsewhere, 'WRONG_MARKET');
});

test('a land job skips a source that only ever produced apartments', () => {
  const outcome = select([source({ id: 'flats', propertyTerms: ['apartment'] })], {
    profileId: 'LAND_SEARCH',
    propertyTerms: ['land'],
  });
  assert.equal(outcome.skipped.find((s) => s.id === 'flats').reason, 'WRONG_PROPERTY_CATEGORY');
});

test('a language mismatch is a skip, and an unclassified source is still tried', () => {
  const wrong = source({ id: 'hebrew-only', languages: ['he'] });
  const unknown = source({ id: 'unclassified', languages: [] });
  const outcome = select([wrong, unknown], { languages: ['ka', 'ru'] });
  assert.equal(outcome.skipped.find((s) => s.id === 'hebrew-only').reason, 'WRONG_LANGUAGE');
  assert.ok(outcome.selected.some((s) => s.id === 'unclassified'), 'an unclassified source was skipped');
});

test('everything over the budget is recorded as OVER_BUDGET rather than vanishing', () => {
  const sources = Array.from({ length: 5 }, (_, i) => source({ id: `s${i}` }));
  const outcome = select(sources, { limit: 2 });
  assert.equal(outcome.selected.length, 2);
  assert.equal(outcome.skipped.filter((s) => s.reason === 'OVER_BUDGET').length, 3);
});

test('selection is deterministic', () => {
  const sources = Array.from({ length: 6 }, (_, i) =>
    source({ id: `d${i}`, productivity: [record({ scanned: 50, useful: i * 3, lastUsefulAt: ago(2) })] }),
  );
  const a = select(sources).selected.map((s) => s.id);
  const b = select(sources).selected.map((s) => s.id);
  assert.deepEqual(a, b);
});

/* ── Back-off and re-scan ─────────────────────────────────────────────── */

test('a repeatedly failing source is backed off, not dropped', () => {
  const failing = source({ id: 'flaky', failureCount: 4, lastScanAt: new Date(NOW - 60_000).toISOString() });
  assert.equal(shouldBackOff(failing, NOW), true);
  assert.equal(select([failing]).skipped.find((s) => s.id === 'flaky').reason, 'BACKED_OFF_AFTER_FAILURES');

  // ...and comes back once enough time has passed. A group that went private
  // for a week is not gone forever.
  const later = { ...failing, lastScanAt: ago(3) };
  assert.equal(shouldBackOff(later, NOW), false);
});

test('back-off grows with the failure count', () => {
  const at = (failures, minutesAgo) =>
    shouldBackOff(
      source({ failureCount: failures, lastScanAt: new Date(NOW - minutesAgo * 60_000).toISOString() }),
      NOW,
    );
  assert.equal(at(2, 30), true);
  assert.equal(at(2, 120), false);
  assert.equal(at(8, 120), true);
});

test('a never-scanned source is always worth a first look', () => {
  assert.equal(needsRescan(source({ lastScanAt: null }), { minIntervalMs: 3_600_000, now: NOW }), true);
});

test('a source scanned ten minutes ago is not re-scanned', () => {
  const recent = source({ lastScanAt: new Date(NOW - 600_000).toISOString() });
  assert.equal(needsRescan(recent, { minIntervalMs: 3_600_000, now: NOW }), false);
  assert.equal(needsRescan(recent, { minIntervalMs: 60_000, now: NOW }), true);
});

/* ── Incremental scanning ─────────────────────────────────────────────── */

test('a successful scan advances the cursor and records what it produced', () => {
  const before = source({ cursor: '2026-09-01T00:00:00.000Z' });
  const after = recordScan(before, {
    profileId: 'BUYER_SEARCH',
    countryCode: 'GE',
    language: 'ka',
    scanned: 40,
    useful: 6,
    cursor: '2026-09-18T10:00:00.000Z',
    at: '2026-09-18T12:00:00.000Z',
  });

  assert.equal(after.cursor, '2026-09-18T10:00:00.000Z');
  assert.equal(after.lastSuccessAt, '2026-09-18T12:00:00.000Z');
  assert.equal(after.failureCount, 0);
  const row = after.productivity.find((r) => r.profileId === 'BUYER_SEARCH');
  assert.equal(row.scanned, 40);
  assert.equal(row.useful, 6);
  assert.equal(row.lastUsefulAt, '2026-09-18T12:00:00.000Z');
});

test('a FAILED scan does NOT advance the cursor', () => {
  // Advancing it after a failure would permanently skip the window the failed
  // scan was supposed to cover — a silent, unrecoverable hole.
  const before = source({ cursor: '2026-09-01T00:00:00.000Z' });
  const after = recordScan(before, {
    profileId: 'BUYER_SEARCH',
    countryCode: 'GE',
    language: 'ka',
    scanned: 0,
    useful: 0,
    cursor: '2026-09-18T10:00:00.000Z',
    failed: true,
    failureReason: 'LOGIN_WALL',
    at: '2026-09-18T12:00:00.000Z',
  });

  assert.equal(after.cursor, '2026-09-01T00:00:00.000Z', 'the cursor advanced past an unread window');
  assert.equal(after.failureCount, 1);
  assert.equal(after.lastFailureReason, 'LOGIN_WALL');
  assert.equal(after.lastSuccessAt, before.lastSuccessAt);
});

test('repeated failure degrades a public source rather than declaring it gone', () => {
  let s = source({ accessState: 'PUBLIC' });
  for (let i = 0; i < 3; i += 1) {
    s = recordScan(s, {
      profileId: 'BUYER_SEARCH', countryCode: 'GE', language: null,
      scanned: 0, useful: 0, failed: true, failureReason: 'NETWORK_ERROR',
      at: '2026-09-18T12:00:00.000Z',
    });
  }
  assert.equal(s.accessState, 'DEGRADED');
  assert.notEqual(s.accessState, 'INACCESSIBLE', 'failures were treated as proof the content is gone');
});

test('a degraded source recovers on a successful scan', () => {
  const degraded = source({ accessState: 'DEGRADED', failureCount: 5 });
  const after = recordScan(degraded, {
    profileId: 'BUYER_SEARCH', countryCode: 'GE', language: null,
    scanned: 10, useful: 2, at: '2026-09-18T12:00:00.000Z',
  });
  assert.equal(after.accessState, 'PUBLIC');
  assert.equal(after.failureCount, 0);
});

test('productivity accumulates across scans rather than being overwritten', () => {
  let s = source();
  for (let i = 0; i < 3; i += 1) {
    s = recordScan(s, {
      profileId: 'BUYER_SEARCH', countryCode: 'GE', language: 'ka',
      scanned: 10, useful: 2, at: '2026-09-18T12:00:00.000Z',
    });
  }
  const row = s.productivity.find((r) => r.profileId === 'BUYER_SEARCH');
  assert.equal(row.scanned, 30);
  assert.equal(row.useful, 6);
  assert.equal(s.productivity.length, 1, 'a duplicate productivity row was created');
});

test('a cursor is only trusted on a source that really is chronological', () => {
  // Most social feeds reorder by engagement. Skipping "older than the cursor"
  // on one of those silently drops new posts that appear below old ones.
  assert.equal(canSkipOlderThanCursor({ chronological: true, cursorIso: ago(1) }), true);
  assert.equal(canSkipOlderThanCursor({ chronological: false, cursorIso: ago(1) }), false);
  assert.equal(canSkipOlderThanCursor({ chronological: true, cursorIso: null }), false);
});
