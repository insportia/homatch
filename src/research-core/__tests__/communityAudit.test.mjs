// AUDITING A COMMUNITY THROUGH THE SAME LADDER AS A WEBSITE.
//
// The website auditor correctly refuses every Telegram channel:
// classifyRegistryRow('https://t.me/tbilisikvartiri') is COMMUNITY_IDENTIFIER with
// auditable: false. This is the community equivalent, and the point of these tests
// is that it did not get its own private idea of what permission means -- it emits
// LifecycleEvidence and advance() decides, exactly as for a portal.
//
// THE DISTINCTION UNDER TEST, above all others: an EMPTY channel and a BLOCKED
// channel must not collapse into each other. Measured in production 2026-09-26:
//
//   @tbilisikvartiri     7 real posts, stable native ids   -> live
//   @tbilisiapartments   4 service notices, nothing else   -> public, no yield
//
// If those two ever land on the same lifecycle state, somebody will either "fix"
// an empty channel by joining something, or go hunting for a bug in a source that
// is simply quiet.

import test from 'node:test';
import assert from 'node:assert/strict';

import { auditCommunityAccess, robotsPermits } from '../discovery/community-audit.ts';
import { advance, findingPermitsAccess } from '../discovery/source-lifecycle.ts';

/** t.me as it actually answers: no robots.txt at all. */
const TME_ROBOTS = { status: 404, disallowed: false };

const ADAPTER = 'telegram-public-preview';

const message = (id, channel = 'tbilisikvartiri') => ({
  messageId: String(id),
  channel,
  permalink: `https://t.me/${channel}/${id}`,
  text: 'Сдается двухкомнатная квартира',
  publishedAt: '2022-11-27T00:00:00.000Z',
  edited: false,
  authorName: null,
  views: null,
  viewsLabel: null,
  replyToMessageId: null,
  hasMedia: false,
});

const page = (overrides = {}) => ({
  outcome: 'OK',
  channel: {
    username: 'tbilisikvartiri',
    title: 'Тбилиси Квартиры',
    numericIdAvailable: false,
    participants: 1234,
    participantsLabel: '1 234 subscribers',
  },
  messages: [message(5), message(16), message(20)],
  nextCursor: null,
  truncated: false,
  serviceMessages: 0,
  detail: '3 public post(s)',
  ...overrides,
});

/** Walk the ladder from DISCOVERED with whatever evidence the audit produced. */
function runLadder(evidence, from = 'DISCOVERED') {
  let state = {
    state: from,
    family: null,
    finding: null,
    adapterId: null,
    failureCount: 0,
    scanned: 0,
    useful: 0,
  };
  const path = [from];
  for (const item of evidence) {
    const result = advance(state, item);
    state = result.state;
    path.push(result.state.state);
  }
  return { state, path };
}

/* ────────────────────────────────────────────────────────────────────────
 * robots decides before content does
 * ──────────────────────────────────────────────────────────────────────── */

test('a 404 robots.txt is unrestricted, which is what t.me actually serves', () => {
  assert.equal(robotsPermits({ status: 404, disallowed: false }), true);
  assert.equal(robotsPermits({ status: 403, disallowed: false }), true, 'any 4xx, per RFC 9309');
});

test('a 5xx robots.txt is not permission', () => {
  // The server failed and we know nothing. An optimistic yes here is how a
  // temporary outage becomes a permanent claim of permission.
  assert.equal(robotsPermits({ status: 503, disallowed: false }), false);
  assert.equal(robotsPermits({ status: null, disallowed: false }), false);
});

test('an explicit disallow beats a readable page', () => {
  const result = auditCommunityAccess({
    page: page(),
    robots: { status: 200, disallowed: true },
    adapterId: ADAPTER,
  });
  assert.equal(result.finding, 'ROBOTS_DISALLOWED');
  assert.equal(findingPermitsAccess(result.finding), false);

  const { state } = runLadder(result.evidence);
  assert.equal(state.state, 'BLOCKED', 'the ladder blocks it, not this module');
});

test('a 5xx robots leaves the lifecycle alone entirely', () => {
  const result = auditCommunityAccess({
    page: page(),
    robots: { status: 502, disallowed: false },
    adapterId: ADAPTER,
  });
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.deepEqual(result.evidence, [], 'no evidence means the ladder is never asked');
});

/* ────────────────────────────────────────────────────────────────────────
 * The live channel: readable, identified, promoted
 * ──────────────────────────────────────────────────────────────────────── */

test('a readable channel with stable native ids reaches LIVE_TESTED', () => {
  const result = auditCommunityAccess({ page: page(), robots: TME_ROBOTS, adapterId: ADAPTER });

  assert.equal(result.verdict, 'ESTABLISHED');
  assert.equal(result.finding, 'PUBLIC_HTML');
  assert.equal(result.family, 'PUBLIC_COMMUNITY');
  assert.equal(result.usableItems, 3);
  assert.equal(result.stableIdentity, true);

  const { state, path } = runLadder(result.evidence);
  assert.deepEqual(
    path,
    ['DISCOVERED', 'AUDITED', 'IMPLEMENTED', 'LIVE_TESTED'],
    'every rung is earned by its own evidence, in order',
  );
  assert.equal(state.finding, 'PUBLIC_HTML');
  assert.equal(state.family, 'PUBLIC_COMMUNITY');
  assert.equal(state.adapterId, ADAPTER);
});

test('the yield is separate evidence, so it can be zero without blocking anything', () => {
  const result = auditCommunityAccess({ page: page(), robots: TME_ROBOTS, adapterId: ADAPTER });
  const kinds = result.evidence.map((e) => e.kind);
  assert.deepEqual(kinds, ['AUDIT', 'ADAPTER_CLAIMED', 'LIVE_FETCH']);
  const live = result.evidence.find((e) => e.kind === 'LIVE_FETCH');
  assert.equal(live.itemsParsed, 3, 'the real count, not a boolean');
});

/* ────────────────────────────────────────────────────────────────────────
 * READABLE AND EMPTY IS NOT BLOCKED
 * ──────────────────────────────────────────────────────────────────────── */

test('a channel of nothing but service notices is PUBLIC and stops at IMPLEMENTED', () => {
  // @tbilisiapartments, exactly. The page is served, no credential is involved,
  // and there is nothing to read.
  const result = auditCommunityAccess({
    page: page({
      outcome: 'PREVIEW_UNAVAILABLE',
      messages: [],
      serviceMessages: 4,
      detail: 'every block was a Telegram service notice',
    }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });

  assert.equal(result.verdict, 'ESTABLISHED');
  assert.equal(result.finding, 'PUBLIC_HTML', 'access IS public; there is simply no content');
  assert.equal(result.usableItems, 0);

  const { state, path } = runLadder(result.evidence);
  assert.deepEqual(path, ['DISCOVERED', 'AUDITED', 'IMPLEMENTED']);
  assert.notEqual(state.state, 'LIVE_TESTED', 'nothing was parsed, so nothing is live-tested');
  assert.notEqual(state.state, 'BLOCKED', 'and an empty channel is not a blocked one');
});

test('an empty channel and a private channel land on different states', () => {
  const empty = auditCommunityAccess({
    page: page({ outcome: 'PREVIEW_UNAVAILABLE', messages: [], serviceMessages: 4 }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });
  const private_ = auditCommunityAccess({
    page: page({ outcome: 'CHANNEL_PRIVATE', messages: [], channel: null }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });

  assert.equal(runLadder(empty.evidence).state.state, 'IMPLEMENTED');
  assert.equal(runLadder(private_.evidence).state.state, 'BLOCKED');
  assert.notEqual(
    empty.finding,
    private_.finding,
    'if these two ever agree, somebody will try to fix emptiness by joining something',
  );
});

/* ────────────────────────────────────────────────────────────────────────
 * A membership wall is named as one
 * ──────────────────────────────────────────────────────────────────────── */

test('a private channel is LOGIN_REQUIRED, not ANTI_BOT and not UNREACHABLE', () => {
  const result = auditCommunityAccess({
    page: page({ outcome: 'CHANNEL_PRIVATE', messages: [], channel: null }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });

  assert.equal(result.finding, 'LOGIN_REQUIRED');
  assert.notEqual(result.finding, 'ANTI_BOT', 'Telegram is not defending against automation here');
  assert.notEqual(result.finding, 'UNREACHABLE', 'it answered; it just will not show us');
  assert.equal(findingPermitsAccess(result.finding), false);
  assert.match(result.reason, /joining is not something this reader does/);
});

/* ────────────────────────────────────────────────────────────────────────
 * Having no opinion, on purpose
 * ──────────────────────────────────────────────────────────────────────── */

test('a channel that does not exist records no finding and does not move', () => {
  // UNREACHABLE would make advance() say "reading this source would mean defeating
  // a control", which is false about a 404 -- nothing is defending anything.
  const result = auditCommunityAccess({
    page: page({ outcome: 'CHANNEL_NOT_FOUND', messages: [], channel: null }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.equal(result.finding, null);
  assert.deepEqual(result.evidence, []);
  assert.equal(runLadder(result.evidence).state.state, 'DISCOVERED', 'unchanged');
});

test('a rate limit is a scheduling fact, not a finding', () => {
  const result = auditCommunityAccess({
    page: page({ outcome: 'RATE_LIMITED', messages: [], channel: null }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.deepEqual(result.evidence, []);
});

test('markup we did not understand is recorded against nobody', () => {
  const result = auditCommunityAccess({
    page: page({ outcome: 'MARKUP_UNRECOGNISED', messages: [], channel: null }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });
  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.match(result.reason, /our defect/);
});

/* ────────────────────────────────────────────────────────────────────────
 * Identity is checked, not assumed
 * ──────────────────────────────────────────────────────────────────────── */

test('a message without a usable native id makes the whole read inconclusive', () => {
  // Storing it would mean inventing an identity, and an invented identity is how
  // an edited post becomes a second purchasable lead.
  const result = auditCommunityAccess({
    page: page({ messages: [message(5), { ...message(9), messageId: 'abc' }] }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });

  assert.equal(result.verdict, 'INCONCLUSIVE');
  assert.equal(result.stableIdentity, false);
  assert.deepEqual(result.evidence, [], 'nothing is promoted on an unusable identity');
  assert.match(result.reason, /inventing identities/);
});

test('an OK page with no messages at all does not claim stable identity', () => {
  const result = auditCommunityAccess({
    page: page({ messages: [] }),
    robots: TME_ROBOTS,
    adapterId: ADAPTER,
  });
  assert.equal(result.stableIdentity, false);
  assert.equal(result.verdict, 'INCONCLUSIVE');
});

/* ────────────────────────────────────────────────────────────────────────
 * It has no private idea of permission
 * ──────────────────────────────────────────────────────────────────────── */

test('every finding this module emits is one the shared ladder already knows', () => {
  const outcomes = [
    'OK', 'PREVIEW_UNAVAILABLE', 'CHANNEL_PRIVATE',
    'CHANNEL_NOT_FOUND', 'RATE_LIMITED', 'MARKUP_UNRECOGNISED',
  ];
  const known = new Set([
    'PUBLIC_HTML', 'API_AVAILABLE', 'FEED_AVAILABLE', 'ROBOTS_DISALLOWED',
    'LOGIN_REQUIRED', 'ANTI_BOT', 'TERMS_PROHIBIT', 'GEO_BLOCKED', 'UNREACHABLE',
  ]);

  for (const outcome of outcomes) {
    const result = auditCommunityAccess({
      page: page({ outcome, messages: outcome === 'OK' ? [message(5)] : [] }),
      robots: TME_ROBOTS,
      adapterId: ADAPTER,
    });
    if (result.finding !== null) {
      assert.ok(known.has(result.finding), `${outcome} produced unknown finding ${result.finding}`);
    }
  }
});

test('only PUBLIC_HTML among the findings it emits permits access', () => {
  // Stated so a future edit cannot quietly add a permitting finding for a surface
  // that has not earned one.
  const permitting = [];
  for (const outcome of ['OK', 'PREVIEW_UNAVAILABLE', 'CHANNEL_PRIVATE']) {
    const result = auditCommunityAccess({
      page: page({ outcome, messages: outcome === 'OK' ? [message(5)] : [] }),
      robots: TME_ROBOTS,
      adapterId: ADAPTER,
    });
    if (result.finding && findingPermitsAccess(result.finding)) permitting.push(result.finding);
  }
  assert.deepEqual([...new Set(permitting)], ['PUBLIC_HTML']);
});
