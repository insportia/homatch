// EVIDENCE THAT GETS FRESHER EVERY TIME WE FAIL TO READ IT.
//
// That is the failure this module is built around, and it is the easiest one
// in the world to write by accident: a revalidation job runs, the fetch times
// out, and somebody sets last_verified_at = now() in the same line that
// records the attempt. From then on the stalest evidence in the system is the
// evidence that looks newest, and the only sources it happens to are the ones
// refusing us.
//
// So the tests below are mostly about which timestamps must NOT move, and
// about the distinction a customer is actually paying for: "we found this six
// weeks ago" and "we checked this yesterday" are different claims.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyRevalidation,
  confirmsValidity,
  DEFAULT_DELIVERY_WINDOW_DAYS,
  describeFreshness,
  firstSighting,
  isConclusive,
  judgeDelivery,
  REVALIDATION_OUTCOMES,
  revalidationPriority,
  VALIDATION_STATES,
} from '../discovery/revalidation.ts';

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

const TEXT = 'იყიდება 2 ოთახიანი ბინა ვაკეში, ფასი 165000 დოლარი.';
const CHANGED = 'იყიდება 2 ოთახიანი ბინა ვაკეში, ფასი 155000 დოლარი.';

const seen = () => firstSighting(iso(T0), TEXT);

/* ── the shape ─────────────────────────────────────────────────────────── */

test('the outcomes split into conclusive and not, and the split is the point', () => {
  assert.equal(REVALIDATION_OUTCOMES.length, 6);
  for (const outcome of ['UNCHANGED_VALID', 'CHANGED_VALID', 'INVALID', 'REMOVED']) {
    assert.equal(isConclusive(outcome), true, `${outcome} should establish something`);
  }
  for (const outcome of ['INACCESSIBLE', 'UNKNOWN']) {
    assert.equal(isConclusive(outcome), false, `${outcome} establishes nothing`);
  }
  assert.equal(confirmsValidity('UNCHANGED_VALID'), true);
  assert.equal(confirmsValidity('INVALID'), false);
  assert.equal(VALIDATION_STATES.length, 5);
});

test('the delivery window is seven days, and it is configurable', () => {
  assert.equal(DEFAULT_DELIVERY_WINDOW_DAYS, 7);
  const old = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  const at = T0 + 10 * DAY;
  assert.equal(judgeDelivery(old, { now: at }).verdict, 'NEEDS_REVALIDATION');
  assert.equal(
    judgeDelivery(old, { now: at, policy: { deliveryWindowDays: 30 } }).verdict,
    'FRESH',
  );
});

/* ── a first sighting is not a verification ────────────────────────────── */

test('seeing something once does not verify it', () => {
  /*
   * The line that would quietly break everything: setting lastVerifiedAt to
   * the discovery time. Every piece of evidence in the system would then be
   * permanently "verified" from the moment it arrived.
   */
  const f = seen();
  assert.equal(f.lastVerifiedAt, null);
  assert.equal(f.validationState, 'UNVERIFIED');
  assert.equal(f.firstSeenAt, f.lastSeenAt);
  assert.equal(f.contentChangedAt, null);
});

test('a fresh sighting is deliverable, and is not called verified', () => {
  // Genuinely worth showing, and a weaker claim than a confirmation. The
  // caller gets a verdict it can render differently, not a boolean.
  const decision = judgeDelivery(seen(), { now: T0 + 2 * DAY });
  assert.equal(decision.verdict, 'NEW_UNVERIFIED');
  assert.equal(decision.deliverable, true);
  assert.notEqual(decision.verdict, 'FRESH');
});

test('an old unverified sighting is not deliverable', () => {
  const decision = judgeDelivery(seen(), { now: T0 + 9 * DAY });
  assert.equal(decision.deliverable, false);
  assert.equal(decision.needsRevalidation, true);
});

/* ── the dangerous edge ────────────────────────────────────────────────── */

test('a failed check does not make evidence fresher', () => {
  /*
   * THE ONE. An inaccessible source establishes nothing about the listing, so
   * lastVerifiedAt, lastSeenAt and contentChangedAt all stay exactly where
   * they were. Only the failure counter moves.
   */
  const before = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  const after = applyRevalidation(before, { outcome: 'INACCESSIBLE', at: iso(T0 + 3 * DAY) }).freshness;

  assert.equal(after.lastVerifiedAt, before.lastVerifiedAt, 'a timeout advanced the verification');
  assert.equal(after.lastSeenAt, before.lastSeenAt, 'a timeout counted as an observation');
  assert.equal(after.expiresAt, before.expiresAt);
  assert.equal(after.failedChecks, 1);
});

test('repeatedly failing to read something never confirms it', () => {
  let f = seen();
  for (let i = 1; i <= 5; i += 1) {
    f = applyRevalidation(f, { outcome: 'INACCESSIBLE', at: iso(T0 + i * DAY) }).freshness;
  }
  assert.equal(f.lastVerifiedAt, null);
  assert.equal(f.failedChecks, 5);
  assert.equal(judgeDelivery(f, { now: T0 + 6 * DAY }).deliverable, false);
});

test('an unreadable check does not overwrite a verdict we already hold', () => {
  // A listing we know is REMOVED does not become "we're not sure" because a
  // later fetch timed out.
  const removed = applyRevalidation(seen(), { outcome: 'REMOVED', at: iso(T0 + DAY) }).freshness;
  const after = applyRevalidation(removed, { outcome: 'UNKNOWN', at: iso(T0 + 2 * DAY) }).freshness;
  assert.equal(after.validationState, 'REMOVED');
});

test('UNKNOWN is as inconclusive as INACCESSIBLE', () => {
  // "We read something and could not judge it" is not a confirmation either.
  const before = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  const after = applyRevalidation(before, {
    outcome: 'UNKNOWN', at: iso(T0 + 3 * DAY), text: CHANGED,
  }).freshness;
  assert.equal(after.lastVerifiedAt, before.lastVerifiedAt);
  assert.equal(after.contentFingerprint, before.contentFingerprint,
    'an unjudgeable read overwrote the fingerprint');
});

/* ── first_seen_at is immutable ────────────────────────────────────────── */

test('nothing moves first_seen_at, ever', () => {
  /*
   * If this moves, every age calculation in the product is wrong and nothing
   * says so. Asserted against every outcome rather than against the one that
   * seemed likely.
   */
  const f = seen();
  for (const outcome of REVALIDATION_OUTCOMES) {
    const after = applyRevalidation(f, { outcome, at: iso(T0 + 5 * DAY), text: CHANGED }).freshness;
    assert.equal(after.firstSeenAt, f.firstSeenAt, `${outcome} moved first_seen_at`);
  }
});

/* ── changed, and not changed ──────────────────────────────────────────── */

test('content_changed_at moves only when the content actually moved', () => {
  const f = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };

  const same = applyRevalidation(f, { outcome: 'UNCHANGED_VALID', at: iso(T0 + DAY), text: TEXT });
  assert.equal(same.contentChanged, false);
  assert.equal(same.freshness.contentChangedAt, null, 're-reading identical text recorded a change');
  assert.equal(same.freshness.lastVerifiedAt, iso(T0 + DAY), 'an unchanged re-read did not re-verify');

  const moved = applyRevalidation(f, { outcome: 'CHANGED_VALID', at: iso(T0 + 2 * DAY), text: CHANGED });
  assert.equal(moved.contentChanged, true);
  assert.equal(moved.freshness.contentChangedAt, iso(T0 + 2 * DAY));
});

test('the fingerprint decides whether content changed, not the caller\'s label', () => {
  /*
   * A caller claiming CHANGED_VALID over identical text is wrong about the
   * content. The fingerprint can be checked; the label is an opinion.
   */
  const f = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  const result = applyRevalidation(f, { outcome: 'CHANGED_VALID', at: iso(T0 + DAY), text: TEXT });
  assert.equal(result.contentChanged, false);
  assert.equal(result.freshness.contentChangedAt, null);
});

test('a price change re-verifies and re-opens the window', () => {
  const f = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  const after = applyRevalidation(f, { outcome: 'CHANGED_VALID', at: iso(T0 + 3 * DAY), text: CHANGED }).freshness;
  assert.equal(after.validationState, 'VALID');
  assert.equal(judgeDelivery(after, { now: T0 + 4 * DAY }).verdict, 'FRESH');
  assert.notEqual(after.contentFingerprint, f.contentFingerprint);
});

/* ── gone, and no longer valid ─────────────────────────────────────────── */

test('removed evidence is never delivered again', () => {
  const removed = applyRevalidation(seen(), { outcome: 'REMOVED', at: iso(T0 + DAY) }).freshness;
  const decision = judgeDelivery(removed, { now: T0 + DAY + 1000 });
  assert.equal(decision.verdict, 'REMOVED');
  assert.equal(decision.deliverable, false);
  // And it is not re-queued: there is nothing to re-check.
  assert.equal(decision.needsRevalidation, false);
});

test('a sold listing is not delivered, and is not called removed', () => {
  // Two different facts. The listing is still there; it no longer qualifies.
  const invalid = applyRevalidation(seen(), {
    outcome: 'INVALID', at: iso(T0 + DAY), text: 'გაიყიდა',
  }).freshness;
  assert.equal(invalid.validationState, 'INVALID');
  assert.equal(judgeDelivery(invalid, { now: T0 + DAY }).deliverable, false);
});

test('a conclusive negative IS an observation', () => {
  // Finding out something is gone is a successful check, not a failed one.
  const removed = applyRevalidation(seen(), { outcome: 'REMOVED', at: iso(T0 + DAY) }).freshness;
  assert.equal(removed.lastSeenAt, iso(T0 + DAY));
  assert.equal(removed.failedChecks, 0);
});

/* ── the seven-day rule ────────────────────────────────────────────────── */

test('evidence older than the window is re-checked before it is shown', () => {
  /*
   * Not shown with a caveat. The requirement is explicit, and the difference
   * matters: a caveat puts the judgement on the customer, who has no way to
   * make it.
   */
  const f = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  const decision = judgeDelivery(f, { now: T0 + 8 * DAY });
  assert.equal(decision.verdict, 'NEEDS_REVALIDATION');
  assert.equal(decision.deliverable, false);
  assert.equal(decision.needsRevalidation, true);
});

test('the boundary is inclusive, so seven days exactly is still fresh', () => {
  const f = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  assert.equal(judgeDelivery(f, { now: T0 + 7 * DAY }).verdict, 'FRESH');
  assert.equal(judgeDelivery(f, { now: T0 + 7 * DAY + 1 }).verdict, 'NEEDS_REVALIDATION');
});

test('a re-check restores deliverability without touching first_seen_at', () => {
  let f = { ...seen(), lastVerifiedAt: iso(T0), validationState: 'VALID' };
  assert.equal(judgeDelivery(f, { now: T0 + 9 * DAY }).deliverable, false);
  f = applyRevalidation(f, { outcome: 'UNCHANGED_VALID', at: iso(T0 + 9 * DAY), text: TEXT }).freshness;
  assert.equal(judgeDelivery(f, { now: T0 + 9 * DAY }).verdict, 'FRESH');
  assert.equal(f.firstSeenAt, iso(T0));
});

/* ── what to re-check first ────────────────────────────────────────────── */

test('the oldest verification is re-checked first', () => {
  const items = [
    { id: 'recent', freshness: { ...seen(), lastVerifiedAt: iso(T0 + 8 * DAY), validationState: 'VALID' } },
    { id: 'ancient', freshness: { ...seen(), lastVerifiedAt: iso(T0 - 60 * DAY), validationState: 'VALID' } },
    { id: 'fresh', freshness: { ...seen(), lastVerifiedAt: iso(T0 + 9 * DAY), validationState: 'VALID' } },
  ];
  const order = revalidationPriority(items, { now: T0 + 10 * DAY });
  assert.equal(order[0], 'ancient');
  assert.equal(order.includes('fresh'), false, 'something inside the window was queued');
});

test('a source that keeps refusing is pushed down, not dropped', () => {
  /*
   * Spending the whole re-check budget on a source that is refusing us means
   * everything else goes unchecked. It is still owed a look, so it moves down
   * the queue rather than off it.
   */
  const stubborn = { ...seen(), lastVerifiedAt: iso(T0 - 90 * DAY), validationState: 'VALID', failedChecks: 6 };
  const ordinary = { ...seen(), lastVerifiedAt: iso(T0 - 30 * DAY), validationState: 'VALID', failedChecks: 0 };
  const order = revalidationPriority(
    [{ id: 'stubborn', freshness: stubborn }, { id: 'ordinary', freshness: ordinary }],
    { now: T0 },
  );
  assert.equal(order[0], 'ordinary');
  assert.ok(order.includes('stubborn'), 'a repeatedly failing source was dropped from the queue');
});

test('the queue is deterministic and respects its budget', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`,
    freshness: { ...seen(), lastVerifiedAt: iso(T0 - (i + 10) * DAY), validationState: 'VALID' },
  }));
  const a = revalidationPriority(items, { now: T0, limit: 3 });
  const b = revalidationPriority(items, { now: T0, limit: 3 });
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
});

/* ── and it never claims more than it knows ────────────────────────────── */

test('the description never says verified when nothing was verified', () => {
  assert.match(describeFreshness(seen(), { now: T0 + DAY }), /Found .* not re-checked/);
  const verified = applyRevalidation(seen(), {
    outcome: 'UNCHANGED_VALID', at: iso(T0 + DAY), text: TEXT,
  }).freshness;
  assert.match(describeFreshness(verified, { now: T0 + 2 * DAY }), /Verified/);
  const failed = applyRevalidation(seen(), { outcome: 'INACCESSIBLE', at: iso(T0 + DAY) }).freshness;
  assert.equal(/Verified/.test(describeFreshness(failed, { now: T0 + 2 * DAY })), false);
});

test('no description invents a percentage', () => {
  for (const state of VALIDATION_STATES) {
    const text = describeFreshness({ ...seen(), validationState: state }, { now: T0 + DAY });
    assert.equal(/%/.test(text), false, `${state} claims a percentage`);
  }
});

/* ── the database agrees with the code ─────────────────────────────────── */

test('the validation states and outcomes are identical in both languages', () => {
  /*
   * Two lists twice. The failure this catches is a sixth outcome added in
   * TypeScript, shipped, and rejected by a CHECK constraint on the
   * revalidation that mattered — at which point the writer either throws in
   * production or gets wrapped in a try/catch and the state stops being
   * recorded at all.
   */
  const sql = readFileSync('supabase/migrations/20260925200000_evidence_freshness.sql', 'utf8');
  const listAfter = (marker) => {
    const at = sql.indexOf(marker);
    assert.ok(at > 0, `the migration no longer declares ${marker}`);
    return [...sql.slice(at, sql.indexOf('))', at)).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(listAfter('check (validation_state in ('), [...VALIDATION_STATES].sort());
  assert.deepEqual(
    listAfter('check (last_revalidation_outcome is null or last_revalidation_outcome in ('),
    [...REVALIDATION_OUTCOMES].sort(),
  );
});

test('the delivery rule is the same rule in both places', () => {
  /*
   * Checked case by case rather than by reading the SQL, because the
   * interesting part is the ORDER: removed-and-invalid before the window,
   * and UNVERIFIABLE before the first-sighting fallback. Getting that order
   * wrong delivers a listing we already know is gone.
   */
  const sql = readFileSync('supabase/migrations/20260925200000_evidence_freshness.sql', 'utf8');
  const fn = sql.slice(sql.indexOf('create or replace function public.evidence_deliverable'));
  const body = fn.slice(0, fn.indexOf('$$;'));

  assert.ok(body.indexOf("'REMOVED', 'INVALID'") < body.indexOf('p_last_verified_at is not null'),
    'the window is checked before the terminal states');
  assert.ok(body.indexOf("= 'UNVERIFIABLE'") < body.indexOf('else p_discovered_at'),
    'a source we cannot read falls through to the first-sighting rule');
  assert.match(body, /greatest\(1, coalesce\(p_window_days, 7\)\)/,
    'the window is not configurable, or has no seven-day default');
});

test('the immutability of discovered_at is enforced, not documented', () => {
  // A bug that silently rewrites the age of every piece of evidence is one
  // nobody would find, so it fails at the write instead.
  const sql = readFileSync('supabase/migrations/20260925200000_evidence_freshness.sql', 'utf8');
  assert.match(sql, /create trigger raw_signals_freeze_discovered_at/);
  assert.match(sql, /discovered_at is immutable/);
});
