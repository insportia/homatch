// THE SEVEN-DAY RULE, WHERE IT ACTUALLY BITES.
//
// revalidation.test.mjs proves the rules in isolation. This proves they are
// WIRED: that run-matching-v2 — the only thing in Homatch that turns external
// evidence into a row a customer sees — refuses stale evidence, queues it
// instead of dropping it, and records what the customer was shown.
//
// A contract that exists in a pure module and nowhere else is a contract that
// is not being kept, and the previous report said so in as many words.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertStripped, stripComments } from '../../../scripts/lib/stripComments.mjs';
import {
  applyRevalidation,
  firstSighting,
  judgeDelivery,
} from '../discovery/revalidation.ts';

const MATCHER = readFileSync('supabase/functions/run-matching-v2/index.ts', 'utf8');
const GATE = readFileSync('supabase/functions/_shared/evidenceFreshness.ts', 'utf8');
const WORKER = readFileSync('supabase/functions/revalidate-evidence/index.ts', 'utf8');
const QUEUE = readFileSync('supabase/migrations/20260925210000_revalidation_queue.sql', 'utf8');
// The comment-aware stripper, not a regex.
//
// A naive one opened a comment inside revalidate-evidence's Accept header --
// the media type that ends in a slash-star wildcard -- and closed it forty
// lines later, deleting the entire HTTP-status mapping. An absence assertion
// over that text would have been green because its subject had been eaten.
//
// Written as line comments on purpose: the string that caused the problem
// cannot be quoted inside a block comment without causing it again, which
// this file already proved once.
const code = (s) => stripComments(s);

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const TEXT = 'იყიდება 2 ოთახიანი ბინა ვაკეში, ფასი 165000 დოლარი.';
const CHANGED = 'იყიდება 2 ოთახიანი ბინა ვაკეში, ფასი 155000 დოლარი.';

const seen = () => firstSighting(iso(T0), TEXT);
const verified = (at) => ({ ...seen(), lastVerifiedAt: iso(at), validationState: 'VALID' });

/* ── the eight outcomes the requirement names ──────────────────────────── */

test('fresh evidence is eligible', () => {
  const decision = judgeDelivery(verified(T0 + 6 * DAY), { now: T0 + 7 * DAY });
  assert.equal(decision.verdict, 'FRESH');
  assert.equal(decision.deliverable, true);
  assert.equal(decision.needsRevalidation, false);
});

test('stale evidence is blocked and pending revalidation', () => {
  const decision = judgeDelivery(verified(T0), { now: T0 + 8 * DAY });
  assert.equal(decision.deliverable, false);
  assert.equal(decision.needsRevalidation, true, 'stale evidence was dropped rather than queued');
});

test('UNCHANGED_VALID makes it fresh again', () => {
  const stale = verified(T0);
  assert.equal(judgeDelivery(stale, { now: T0 + 9 * DAY }).deliverable, false);
  const after = applyRevalidation(stale, {
    outcome: 'UNCHANGED_VALID', at: iso(T0 + 9 * DAY), text: TEXT,
  }).freshness;
  assert.equal(judgeDelivery(after, { now: T0 + 9 * DAY }).verdict, 'FRESH');
  assert.equal(after.contentChangedAt, null, 'an unchanged re-read recorded a content change');
});

test('CHANGED_VALID updates the canonical evidence correctly', () => {
  const stale = verified(T0);
  const result = applyRevalidation(stale, {
    outcome: 'CHANGED_VALID', at: iso(T0 + 9 * DAY), text: CHANGED,
  });
  assert.equal(result.contentChanged, true);
  assert.notEqual(result.freshness.contentFingerprint, stale.contentFingerprint);
  assert.equal(result.freshness.contentChangedAt, iso(T0 + 9 * DAY));
  assert.equal(result.freshness.lastVerifiedAt, iso(T0 + 9 * DAY));
  assert.equal(result.freshness.firstSeenAt, stale.firstSeenAt, 'first_seen_at moved');
  assert.equal(judgeDelivery(result.freshness, { now: T0 + 9 * DAY }).deliverable, true);
});

test('INVALID is excluded and is not re-queued', () => {
  const after = applyRevalidation(verified(T0), {
    outcome: 'INVALID', at: iso(T0 + DAY), text: 'გაიყიდა',
  }).freshness;
  const decision = judgeDelivery(after, { now: T0 + DAY });
  assert.equal(decision.deliverable, false);
  // Nothing to re-check: we conclusively established it no longer qualifies.
  assert.equal(decision.needsRevalidation, false);
});

test('REMOVED is excluded and is not re-queued', () => {
  const after = applyRevalidation(verified(T0), { outcome: 'REMOVED', at: iso(T0 + DAY) }).freshness;
  const decision = judgeDelivery(after, { now: T0 + DAY });
  assert.equal(decision.verdict, 'REMOVED');
  assert.equal(decision.deliverable, false);
  assert.equal(decision.needsRevalidation, false);
});

test('INACCESSIBLE is never called verified', () => {
  const before = verified(T0);
  const after = applyRevalidation(before, { outcome: 'INACCESSIBLE', at: iso(T0 + 9 * DAY) }).freshness;
  assert.equal(after.lastVerifiedAt, before.lastVerifiedAt);
  assert.equal(judgeDelivery(after, { now: T0 + 9 * DAY }).deliverable, false);
});

test('UNKNOWN does not silently become fresh', () => {
  const before = seen();
  const after = applyRevalidation(before, {
    outcome: 'UNKNOWN', at: iso(T0 + 9 * DAY), text: CHANGED,
  }).freshness;
  assert.equal(after.lastVerifiedAt, null);
  assert.equal(after.contentFingerprint, before.contentFingerprint);
  assert.equal(judgeDelivery(after, { now: T0 + 9 * DAY }).deliverable, false);
});

test('historical evidence is retained, never deleted', () => {
  /*
   * Every outcome produces a NEW state object and none of them is an absence.
   * A revalidation that finds a listing gone records that it is gone; it does
   * not remove the evidence that it once existed.
   */
  for (const outcome of ['UNCHANGED_VALID', 'CHANGED_VALID', 'INVALID', 'REMOVED', 'INACCESSIBLE', 'UNKNOWN']) {
    const after = applyRevalidation(seen(), { outcome, at: iso(T0 + DAY), text: CHANGED }).freshness;
    assert.ok(after.firstSeenAt, `${outcome} lost the first sighting`);
    assert.equal(after.firstSeenAt, iso(T0));
  }
  assert.equal(/delete\s+from\s+public\.raw_signals/i.test(QUEUE), false,
    'the freshness migration deletes evidence');
  assert.equal(/\.delete\(\)/.test(code(GATE)), false, 'the gate deletes evidence');
});

/* ── the wiring ────────────────────────────────────────────────────────── */

test('the match writer gates on freshness before creating a match', () => {
  /*
   * THE ONE THAT CLOSES THE GAP. run-matching-v2 is the only thing that turns
   * external evidence into a customer-visible row, and until now it gated on
   * classification and nothing else — a signal verified in March was as
   * deliverable as one verified this morning.
   */
  const c = code(MATCHER);
  assert.match(c, /gateForDelivery\(db, profile\.signal_id, signal/);
  assert.match(c, /if \(!gate\.deliverable\) \{/);
  // And the gate runs BEFORE the insert, not as a label on it.
  assert.ok(c.indexOf('gateForDelivery') < c.indexOf("from('matches').insert"),
    'the freshness gate runs after the match is written');
});

test('the gate reads the columns it judges', () => {
  /*
   * The silent-failure version of this feature: judging a row whose freshness
   * columns were never selected. Every signal would read as unverified, every
   * campaign would deliver nothing, and the gate would look like it was
   * working.
   */
  assert.match(MATCHER, /\$\{FRESHNESS_COLUMNS\}/);
  assert.match(GATE, /export const FRESHNESS_COLUMNS/);
  for (const column of ['last_verified_at', 'validation_state', 'discovered_at', 'failed_checks']) {
    assert.match(GATE, new RegExp(column), `${column} is not selected`);
  }
});

test('stale evidence is queued rather than dropped', () => {
  // Dropping it would shrink the corpus every week with nothing recording why.
  assert.match(code(GATE), /request_revalidation/);
  assert.match(code(MATCHER), /queuedRevalidations/);
});

test('conclusively dead evidence is not queued', () => {
  // Re-reading something we know is gone is spending money to learn it again.
  const gateFn = code(GATE).slice(code(GATE).indexOf('export async function gateForDelivery'));
  assert.match(gateFn, /if \(!decision\.needsRevalidation\)[\s\S]{0,200}return/);
});

test('a failure to queue never becomes a delivery', () => {
  const gateFn = code(GATE).slice(code(GATE).indexOf('export async function gateForDelivery'));
  const cat = gateFn.slice(gateFn.indexOf('catch'));
  assert.equal(/deliverable: true/.test(cat), false,
    'a queueing failure falls through to delivering stale evidence');
});

test('what the customer was shown is recorded on the match', () => {
  // Stored rather than re-derived: the timestamps it was judged on will have
  // moved by the time anybody asks.
  assert.match(code(MATCHER), /evidence_freshness: gate\.decision\.verdict/);
  assert.match(QUEUE, /check \(evidence_freshness is null or evidence_freshness in \('FRESH', 'NEW_UNVERIFIED'\)\)/);
});

test('only the two deliverable verdicts can be recorded as delivered', () => {
  /*
   * The CHECK is the backstop. If the gate were ever bypassed, a match
   * carrying REMOVED would fail at the write rather than reach a customer.
   */
  const allowed = [...QUEUE.slice(QUEUE.indexOf('evidence_freshness in (')).matchAll(/'([A-Z_]+)'/g)]
    .map((m) => m[1]).slice(0, 2).sort();
  assert.deepEqual(allowed, ['FRESH', 'NEW_UNVERIFIED']);
});

/* ── no network work from a page view ──────────────────────────────────── */

test('nothing in the frontend can trigger a revalidation fetch', () => {
  /*
   * The requirement, asserted structurally. Re-reading on page view would put
   * somebody else's latency inside a page load and turn a popular property
   * into a denial-of-service against a source that did nothing wrong.
   */
  const api = readFileSync('src/services/api.ts', 'utf8');
  assert.equal(/request_revalidation|claim_revalidation|revalidate-evidence/.test(api), false,
    'the frontend API layer can schedule or perform revalidation');
});

test('the match writer schedules work and never performs it', () => {
  // The gate module must contain no fetch: a re-read inside a match run puts
  // a third party's server in the campaign's critical path.
  assert.equal(/\bfetch\s*\(/.test(code(GATE)), false, 'the gate fetches');
  assert.equal(/\bfetch\s*\(/.test(code(MATCHER)), false, 'the match writer fetches');
});

/* ── concurrency and dedup, as the SQL declares them ───────────────────── */

test('one open revalidation job per signal, whatever asks', () => {
  /*
   * run-matching-v2 runs per campaign. One popular signal can be a candidate
   * for forty properties in a minute, and without this that is forty
   * identical re-reads of one page.
   */
  assert.match(QUEUE, /create unique index if not exists revalidation_queue_open_signal_key[\s\S]*?where status in \('PENDING', 'CLAIMED'\)/);
});

test('a racing second request returns the existing job rather than failing', () => {
  // A campaign must not error because another campaign asked for the same
  // re-check a millisecond earlier.
  const fn = QUEUE.slice(QUEUE.indexOf('create or replace function public.request_revalidation'));
  assert.match(fn, /when unique_violation then/);
  assert.match(fn, /return existing/);
});

test('two workers cannot claim the same job', () => {
  assert.match(QUEUE, /for update skip locked/);
});

test('a worker that dies mid-fetch does not strand its job', () => {
  // An expired lease is reclaimable, so there is no reaper to forget to run.
  const fn = QUEUE.slice(QUEUE.indexOf('create or replace function public.claim_revalidation'));
  assert.match(fn, /claimed_at < now\(\) - make_interval\(mins =>/);
});

test('an inconclusive outcome does not close the job', () => {
  // Establishing nothing is not the same as finishing.
  const fn = QUEUE.slice(QUEUE.indexOf('create or replace function public.complete_revalidation'));
  assert.match(fn, /when p_outcome in \('INACCESSIBLE', 'UNKNOWN'\)[\s\S]{0,80}then 'PENDING'/);
  // And it is bounded, so an unreadable source does not retry forever.
  assert.match(fn, /then 'FAILED'/);
});

/* ── the worker's own refusals ─────────────────────────────────────────── */

test('the worker never requests an unaudited source', () => {
  /*
   * BLOCKED is the easy case. The harder one is DISCOVERED: a URL some
   * earlier sweep put in the registry whose robots.txt nobody has ever
   * asked. Production makes this immediate rather than theoretical -- all
   * 119 classified signals are outside the seven-day window and nearly all
   * come from Reddit communities the retired discovery registered without
   * auditing, so a naive worker would make several hundred requests to a
   * site whose terms nobody here has read.
   */
  const c = code(WORKER);
  assert.match(c, /PERMITTED_FINDINGS/);
  assert.ok(c.indexOf('PERMITTED_FINDINGS.has') < c.indexOf('await reread('),
    'the permission check runs after the fetch');
  // And the refusal is UNKNOWN, which establishes nothing and therefore
  // cannot make the evidence look fresher than it is.
  const branch = c.slice(c.indexOf('!PERMITTED_FINDINGS.has'));
  assert.match(branch.slice(0, 400), /outcome: 'UNKNOWN'/);
});

test('the worker never requests a blocked source', () => {
  /*
   * The block is a decision about whether we may read a source at all, and a
   * background worker is not the place to relitigate it. Fetching anyway
   * would be exactly the bypass the lifecycle exists to prevent.
   */
  const c = code(WORKER);
  assert.match(c, /BLOCKED_LIFECYCLES/);
  assert.ok(c.indexOf('BLOCKED_LIFECYCLES.has(sourceLifecycle)') < c.indexOf('await reread('),
    'the block check runs after the fetch');
});

test('the worker maps HTTP status to meaning, not to success', () => {
  // assertStripped, so a stripper that ate the mapping fails loudly here
  // rather than letting the absence tests below pass for the wrong reason.
  const c = assertStripped(WORKER, ['404', 'REMOVED', 'INACCESSIBLE']);
  assert.match(c, /status === 404 \|\| response\.status === 410[\s\S]{0,120}REMOVED/);
  assert.match(c, /401[\s\S]{0,160}INACCESSIBLE/);
});

test('a 200 carrying nothing readable is UNKNOWN, not a confirmation', () => {
  // A cookie wall and a consent interstitial both answer 200.
  const c = code(WORKER);
  assert.match(c, /if \(!text\) \{[\s\S]{0,200}'UNKNOWN'/);
});

test('the worker identifies itself', () => {
  assert.match(WORKER, /HomatchResearch\/1\.0/);
  assert.equal(/Mozilla|Chrome\/[0-9]/.test(WORKER), false, 'the worker impersonates a browser');
});

test('the worker does not reach a retired provider', () => {
  assert.equal(/apify|dataforseo/i.test(WORKER), false);
});

test('the worker is a cron worker, not a customer surface', () => {
  assert.match(WORKER, /revalidation_worker_token/);
  assert.match(WORKER, /Forbidden.*403|403/);
});

/* ── convergence: Homatch's own demand reaching the matcher ─────────────── */

test('the matcher reads globally-discovered demand, not only acquired candidates', () => {
  /*
   * THE GAP THIS CLOSES. property_signal_candidates records demand somebody
   * paid to find FOR ONE PROPERTY. Demand Homatch discovers on its own --
   * a forum board read with no property in mind -- lands in intent_profiles
   * linked to nothing, so the matcher never saw a row of it.
   *
   * Production, 2026-09-25, property c5c1a6a4: 680 acquired candidates, ZERO
   * from Homatch's own discovery, while five classified forum profiles for
   * the same city went unread. The demand half was writing rows nobody read.
   */
  const c = code(MATCHER);
  assert.match(c, /from\('intent_profiles'\)[\s\S]{0,160}\.ilike\('city'/,
    'the matcher never queries the global store by market');
  // Both ways in, unioned — not the global set replacing the acquired one.
  assert.match(c, /const signalIds = \[\.\.\.linked, \.\.\.new Set\(globalOnly\)\]/);
});

test('global demand is bounded and scoped to the property market', () => {
  /*
   * The acquired set grows with the research done for one property. The
   * global set grows with the whole market, so an unbounded read is a
   * different shape of query wearing the same name.
   */
  const c = code(MATCHER);
  assert.match(c, /\.limit\(GLOBAL_DEMAND_LIMIT\)/);
  // A city name without a country is a different city somewhere else.
  assert.match(c, /country\.is\.null,country\.eq\.\$\{marketCountry\}/);
  /* That country goes into a PostgREST `or` string, not a bound value, so a
     comma or paren arriving from imported listing data would be read as more
     filter syntax. Letters and dashes only. */
  assert.match(c, /marketCountry[\s\S]{0,140}replace\(\/\[\^A-Za-z-\]\/g, ''\)/);
  // No market, no global read — never a whole-table scan.
  assert.match(c, /if \(includeGlobalDemand && marketCity\)/);
});

test('global demand passes the same freshness gate as every other candidate', () => {
  /*
   * The failure this forbids: a second way in that skips the seven-day rule,
   * so unverified evidence becomes a customer-visible match by taking the
   * other door. The union happens BEFORE the gate, so there is only one door.
   */
  const c = code(MATCHER);
  /* The CALL SITE, not the import. `gateForDelivery` first appears in the
     import block at the top of the file, which is before everything and so
     would make this assertion true no matter where the gate actually ran. */
  const gateCall = c.indexOf('gateForDelivery(db, profile.signal_id');
  const union = c.indexOf('const signalIds = [...linked');
  assert.ok(union > 0, 'the union of both candidate sources is gone');
  assert.ok(gateCall > 0, 'the gate call site is gone');
  assert.ok(union < gateCall,
    'global candidates are assembled after the freshness gate runs');
});

test('the response distinguishes "saw none of ours" from "saw ours and rejected them"', () => {
  // Zero matches meant both, and they call for opposite fixes.
  const c = code(MATCHER);
  assert.match(c, /acquiredCandidates: linked\.size/);
  assert.match(c, /globalDemandCandidates: globalOnly\.length/);
});
