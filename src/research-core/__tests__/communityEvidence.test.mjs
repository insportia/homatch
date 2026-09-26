// AN EDITED POST IS NOT A SECOND LEAD.
//
// That sentence is the whole file. The same defect has already cost money once,
// in a different table: run-matching-v2 keyed duplicate detection on
// intent_profile_id, an id that does not survive re-classification, so forum.ge
// post 14328580 came back with a fresh id and one buyer was offered for sale
// twice — 35 credits paid, 20 more asked.
//
// Community content edits constantly. If identity came from the text, every typo
// correction would manufacture a new purchasable lead out of the same human being
// asking for the same flat. So identity is platform-native, the fingerprint is a
// separate question, and an edit resolves to VERSION.
//
// The second theme is that Verify must not notice any of this. PublicSignal is a
// frozen contract; CommunityEvidence extends it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  asCommunityEvidence,
  parentEvidenceId,
  planObservation,
  timeBounds,
  truncUnit,
  bucketCount,
} from '../signals/community-evidence.ts';
import { stableSignalId, UnstableIdentityError } from '../signals/identity.ts';

/** A PublicSignal as an adapter would hand one over, with a WRONG id on purpose. */
const signal = (text, overrides = {}) => ({
  // meta-platform.ts computes this from contentUrl ?? contentHash(text). It is
  // deliberately nonsense here: asCommunityEvidence must overwrite it.
  id: 'sig_from_a_text_hash_do_not_trust',
  platform: 'FACEBOOK',
  contentType: 'COMMENT',
  sourceUrl: 'https://facebook.com/groups/tbilisiflats',
  contentUrl: null,
  parentUrl: null,
  parentExcerpt: null,
  author: { publicName: 'A Person', publicUrl: null },
  originalText: text,
  translatedText: null,
  language: 'en',
  publishedAt: '2026-09-25T10:00:00.000Z',
  discoveredAt: '2026-09-26T09:00:00.000Z',
  lastSeenAt: '2026-09-26T09:00:00.000Z',
  contentFingerprint: `fp:${text.length}`,
  direction: 'DEMAND',
  directionConfidence: 0.8,
  locationHints: { countryCode: null, city: null, district: null, mentions: [] },
  requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: null, budgetCurrency: null },
  accessClass: 'PUBLIC',
  ...overrides,
});

const identity = {
  platform: 'FACEBOOK',
  communityId: 'tbilisiflats',
  externalContentId: '1234567890_9876',
  parentContentId: '1234567890',
};

test('the identity comes from native ids, and the adapter id is discarded', () => {
  const evidence = asCommunityEvidence(signal('Looking for a 2BR in Vake'), {
    identity, acquisitionMode: 'PUBLIC_WEB',
  });

  assert.notEqual(evidence.id, 'sig_from_a_text_hash_do_not_trust',
    'the adapter-supplied id survived, carrying the text-hash defect into the store');
  assert.equal(evidence.id, stableSignalId(identity));
  assert.equal(evidence.externalContentId, '1234567890_9876');
  assert.equal(evidence.communityId, 'tbilisiflats');
});

test('EDITING THE TEXT DOES NOT CHANGE THE IDENTITY', () => {
  /* The load-bearing test. Same native ids, different words. */
  const before = asCommunityEvidence(signal('Looking for a 2BR in Vake'), {
    identity, acquisitionMode: 'PUBLIC_WEB',
  });
  const after = asCommunityEvidence(signal('Looking for a 2BR in Vake, up to $180k'), {
    identity, acquisitionMode: 'PUBLIC_WEB',
  });

  assert.equal(before.id, after.id, 'an edit produced a different signal id, which is a second lead');
  assert.notEqual(before.contentFingerprint, after.contentFingerprint,
    'the fingerprint did not move, so an edit would be invisible');
});

test('an adapter with no native id is refused, not given a hash', () => {
  for (const broken of [
    { platform: 'FACEBOOK', communityId: 'x', externalContentId: '' },
    { platform: 'FACEBOOK', communityId: 'x', externalContentId: '   ' },
    { platform: 'TELEGRAM', communityId: '', externalContentId: '42' },
  ]) {
    assert.throws(
      () => asCommunityEvidence(signal('text'), { identity: broken, acquisitionMode: 'PUBLIC_WEB' }),
      UnstableIdentityError,
      `${JSON.stringify(broken)} was given an identity it had not earned`,
    );
  }
});

test('a Telegram message id is scoped to its chat', () => {
  /* Message 42 exists in every channel that has posted 42 times. Without the
     chat in the key, two different messages collapse into one signal and evidence
     is silently deleted. */
  const a = stableSignalId({ platform: 'TELEGRAM', communityId: 'chan_a', externalContentId: '42' });
  const b = stableSignalId({ platform: 'TELEGRAM', communityId: 'chan_b', externalContentId: '42' });
  assert.notEqual(a, b);
});

test('a comment links to its parent by native id', () => {
  const evidence = asCommunityEvidence(signal('is this still available?'), {
    identity, acquisitionMode: 'PUBLIC_WEB',
  });
  assert.equal(parentEvidenceId(evidence),
    stableSignalId({ platform: 'FACEBOOK', communityId: 'tbilisiflats', externalContentId: '1234567890' }));

  /* A top-level post has no parent, and that is not a lost parent. */
  const post = asCommunityEvidence(signal('Flat available'), {
    identity: { ...identity, parentContentId: null }, acquisitionMode: 'PUBLIC_WEB',
  });
  assert.equal(parentEvidenceId(post), null);
});

/* ── re-observation ──────────────────────────────────────────────────────── */

const NOW = '2026-09-26T12:00:00.000Z';
const stored = (over = {}) => ({
  id: 'sig_x', contentFingerprint: 'fp:25', contentVersion: 1,
  lastSeenAt: '2026-09-26T09:00:00.000Z', availability: 'AVAILABLE',
  becameUnavailableAt: null, ...over,
});

test('re-scanning unchanged content only touches lastSeenAt', () => {
  const plan = planObservation(stored(), { contentFingerprint: 'fp:25' }, NOW);
  assert.equal(plan.action, 'TOUCH');
  assert.equal(plan.contentVersion, 1, 'a re-scan bumped the version with nothing to show for it');
  assert.match(plan.reason, /must not produce a second lead/);
});

test('an edit becomes a VERSION of one lead, never an INSERT', () => {
  const plan = planObservation(stored(), { contentFingerprint: 'fp:39' }, NOW);
  assert.equal(plan.action, 'VERSION');
  assert.notEqual(plan.action, 'INSERT');
  assert.equal(plan.contentVersion, 2);
  assert.match(plan.reason, /never a second purchasable lead/);
});

test('an unseen native id is an INSERT at version 1', () => {
  const plan = planObservation(null, { contentFingerprint: 'fp:25' }, NOW);
  assert.equal(plan.action, 'INSERT');
  assert.equal(plan.contentVersion, 1);
});

test('a stored row with no fingerprint is treated as edited, not as unchanged', () => {
  /* Fail toward showing the customer fresh evidence rather than toward silently
     assuming nothing moved. */
  const plan = planObservation(stored({ contentFingerprint: null }), { contentFingerprint: 'fp:25' }, NOW);
  assert.equal(plan.action, 'VERSION');
});

test('REMOVED and INACCESSIBLE are recorded differently', () => {
  const removed = planObservation(stored(), { contentFingerprint: 'fp:25', availability: 'REMOVED' }, NOW);
  assert.equal(removed.action, 'MARK_UNAVAILABLE');
  assert.equal(removed.availability, 'REMOVED');
  assert.equal(removed.becameUnavailableAt, NOW);
  assert.match(removed.reason, /never deleted/);

  const unreachable = planObservation(stored(), { contentFingerprint: 'fp:25', availability: 'INACCESSIBLE' }, NOW);
  assert.equal(unreachable.availability, 'INACCESSIBLE');
  assert.match(unreachable.reason, /fact about our access/);
  /* The distinction that matters: our outage must not read as the author
     withdrawing their requirement. */
  assert.notEqual(unreachable.availability, removed.availability);
});

test('re-checking something already gone does not move the moment it went', () => {
  /*
   * A deleted post re-checked hourly must not record "gone since a minute ago"
   * forever. "Gone since Tuesday" is the useful fact.
   */
  const plan = planObservation(
    stored({ availability: 'REMOVED', becameUnavailableAt: '2026-09-24T08:00:00.000Z' }),
    { contentFingerprint: 'fp:25', availability: 'REMOVED' },
    NOW,
  );
  assert.equal(plan.becameUnavailableAt, '2026-09-24T08:00:00.000Z');
});

/* ── time windows ────────────────────────────────────────────────────────── */

const AT = new Date('2026-09-26T12:30:00.000Z');

test('durations are durations, in any timezone', () => {
  for (const tz of [0, 240, -300]) {
    const b = timeBounds({ window: 'LAST_24H', tzOffsetMinutes: tz }, AT);
    assert.equal(Date.parse(b.to) - Date.parse(b.from), 86_400_000,
      `LAST_24H changed length at offset ${tz}`);
  }
  assert.equal(Date.parse(timeBounds({ window: 'LAST_HOUR' }, AT).to)
    - Date.parse(timeBounds({ window: 'LAST_HOUR' }, AT).from), 3_600_000);
});

test('CALENDAR windows follow the operator\'s clock, not UTC', () => {
  /*
   * A Tbilisi operator (UTC+4) at 12:30 UTC is at 16:30 local, so "today" starts
   * at 20:00 the previous UTC day. Using UTC midnight would silently report the
   * wrong day's numbers — the kind of off-by-one that looks entirely plausible.
   */
  const utc = timeBounds({ window: 'TODAY', tzOffsetMinutes: 0 }, AT);
  assert.equal(utc.from, '2026-09-26T00:00:00.000Z');

  const tbilisi = timeBounds({ window: 'TODAY', tzOffsetMinutes: 240 }, AT);
  assert.equal(tbilisi.from, '2026-09-25T20:00:00.000Z');
  assert.notEqual(tbilisi.from, utc.from);
});

test('YESTERDAY ends where TODAY begins, with no gap and no overlap', () => {
  const today = timeBounds({ window: 'TODAY', tzOffsetMinutes: 240 }, AT);
  const yesterday = timeBounds({ window: 'YESTERDAY', tzOffsetMinutes: 240 }, AT);
  assert.equal(yesterday.to, today.from,
    'the two windows do not meet, so a row can be counted twice or not at all');
});

test('THIS_WEEK starts on Monday, and Sunday is the end of a week', () => {
  /* getUTCDay() makes Sunday 0, so a naive implementation puts Sunday at the
     START of the coming week and reports one day where it means seven. */
  const sunday = new Date('2026-09-27T12:00:00.000Z');
  const bounds = timeBounds({ window: 'THIS_WEEK' }, sunday);
  assert.equal(bounds.from, '2026-09-21T00:00:00.000Z', 'Sunday was treated as a week start');

  const monday = new Date('2026-09-28T12:00:00.000Z');
  assert.equal(timeBounds({ window: 'THIS_WEEK' }, monday).from, '2026-09-28T00:00:00.000Z');
});

test('THIS_MONTH starts on the first', () => {
  assert.equal(timeBounds({ window: 'THIS_MONTH' }, AT).from, '2026-09-01T00:00:00.000Z');
});

test('the column is explicit, because published and discovered are different questions', () => {
  assert.equal(timeBounds({ window: 'TODAY' }, AT).column, 'discovered_at');
  assert.equal(timeBounds({ window: 'TODAY', column: 'published_at' }, AT).column, 'published_at');
});

test('a CUSTOM window validates rather than guessing', () => {
  assert.throws(() => timeBounds({ window: 'CUSTOM' }, AT), /needs both from and to/);
  assert.throws(() => timeBounds({ window: 'CUSTOM', from: 'nonsense', to: 'also' }, AT),
    /parseable/);
  assert.throws(() => timeBounds({
    window: 'CUSTOM', from: '2026-09-26T00:00:00Z', to: '2026-09-25T00:00:00Z',
  }, AT), /cannot start after it ends/);

  const ok = timeBounds({
    window: 'CUSTOM', from: '2026-09-01T00:00:00Z', to: '2026-09-15T00:00:00Z',
  }, AT);
  assert.equal(ok.from, '2026-09-01T00:00:00.000Z');
});

test('the bucket unit is an allowlist that returns a literal', () => {
  /* A bucket name interpolated into date_trunc() unchecked is an injection. */
  assert.equal(truncUnit('HOUR'), 'hour');
  assert.equal(truncUnit('MONTH'), 'month');
  assert.throws(() => truncUnit('day; drop table raw_signals'), /unknown time bucket/);
});

test('bucket counts let a caller refuse an absurd chart', () => {
  const month = timeBounds({ window: 'LAST_30D' }, AT);
  assert.equal(bucketCount(month, 'DAY'), 30);
  assert.equal(bucketCount(month, 'HOUR'), 720);
  const wide = timeBounds({ window: 'CUSTOM', from: '2021-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }, AT);
  assert.ok(bucketCount(wide, 'HOUR') > 40_000);
});

/* ── the frozen contract ─────────────────────────────────────────────────── */

test('PublicSignal is not modified to support any of this', () => {
  /*
   * Verify reaches PublicSignal through adapters/portal/types.ts and
   * discovery/adapter.ts. I had begun adding these fields to it as REQUIRED
   * members before checking who consumed it; that would have changed an approved
   * product to suit new work and broken every existing constructor. This asserts
   * the revert held.
   */
  const source = readFileSync('src/research-core/signals/types.ts', 'utf8');
  for (const added of ['communityId', 'externalContentId', 'acquisitionMode', 'connectionId',
    'targetId', 'becameUnavailableAt', 'contentVersion', 'sourceUpdatedAt']) {
    assert.equal(source.includes(added), false,
      `PublicSignal gained ${added}; the community fields belong in the extension`);
  }
  /* And the extension really does extend it rather than re-declare a rival. */
  const extension = readFileSync('src/research-core/signals/community-evidence.ts', 'utf8');
  assert.match(extension, /interface CommunityEvidence extends PublicSignal/);
});

test('no duplicate of a time field that already exists', () => {
  /*
   * raw_signals already carries published_at, discovered_at, last_seen_at,
   * last_verified_at, content_changed_at and content_fingerprint. A second
   * `firstSeenAt` beside the inherited `discoveredAt` would be exactly the
   * renamed duplicate the audit existed to prevent.
   */
  const extension = readFileSync('src/research-core/signals/community-evidence.ts', 'utf8');
  const declared = extension.slice(
    extension.indexOf('interface CommunityEvidence'),
    extension.indexOf('export interface CommunityEvidenceInput'),
  );
  for (const duplicate of ['firstSeenAt', 'sourcePublishedAt', 'lastVerified', 'fingerprint']) {
    assert.equal(declared.includes(duplicate), false,
      `CommunityEvidence re-declares ${duplicate}, which PublicSignal already carries`);
  }
});
