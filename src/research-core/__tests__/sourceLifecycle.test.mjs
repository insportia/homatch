// A SOURCE REGISTRY THAT CANNOT BE TALKED INTO A PROMOTION.
//
// The lifecycle exists to stop the registry becoming a wish list, so these
// tests are mostly about what it REFUSES. Every state below is reachable only
// by evidence of a specific kind, and the four refusals that matter are:
//
//   a blocked source is never promoted by fetching it anyway
//   a fixture never becomes a live test
//   one lucky scan never becomes "productive"
//   a retired source is never revived by a successful scan
//
// The happy paths are here too, but they are the easy half. A ladder that
// only ever goes up is not a ladder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advance,
  describeLifecycle,
  DEGRADE_AFTER_FAILURES,
  findingPermitsAccess,
  initialState,
  isSourceFamily,
  isSourceLifecycle,
  ladderIndex,
  mayDeliverResults,
  mayScanForCampaign,
  PRODUCTIVE_MIN_SCANNED,
  PRODUCTIVE_MIN_USEFUL,
  shouldGraduateToDedicatedAdapter,
  SOURCE_FAMILIES,
  SOURCE_LIFECYCLE_STATES,
} from '../discovery/source-lifecycle.ts';

/** Walk a source up to a named state using only legitimate evidence. */
function reach(target, family = 'PROPERTY_PORTAL') {
  let s = initialState();
  const step = (evidence) => { s = advance(s, evidence).state; };

  if (target === 'DISCOVERED') return s;
  step({ kind: 'AUDIT', family, finding: 'PUBLIC_HTML' });
  if (target === 'AUDITED') return s;
  step({ kind: 'ADAPTER_CLAIMED', adapterId: 'portal' });
  if (target === 'IMPLEMENTED') return s;
  step({ kind: 'FIXTURE_PASS', adapterId: 'portal' });
  if (target === 'FIXTURE_TESTED') return s;
  step({ kind: 'LIVE_FETCH', ok: true, itemsParsed: 12 });
  if (target === 'LIVE_TESTED') return s;
  step({ kind: 'SCAN', scanned: 40, useful: 9, language: 'ka' });
  return s;
}

/* ── the shape of it ───────────────────────────────────────────────────── */

test('the states and families are closed sets', () => {
  assert.equal(SOURCE_LIFECYCLE_STATES.length, 10);
  assert.equal(isSourceLifecycle('PRODUCTIVE'), true);
  assert.equal(isSourceLifecycle('EXCELLENT'), false);
  assert.equal(isSourceFamily('TELEGRAM'), true);
  assert.equal(isSourceFamily('SCRAPER'), false);
  assert.ok(SOURCE_FAMILIES.includes('EXPAT_COMMUNITY'));
});

test('the ladder puts the outcome states outside it', () => {
  // DEGRADED, BLOCKED and RETIRED are not rungs — a source does not progress
  // towards being blocked.
  for (const state of ['DEGRADED', 'BLOCKED', 'RETIRED']) {
    assert.equal(ladderIndex(state), -1, `${state} is on the ladder`);
  }
  assert.ok(ladderIndex('PRODUCTIVE') > ladderIndex('LIVE_TESTED'));
  assert.ok(ladderIndex('LIVE_TESTED') > ladderIndex('FIXTURE_TESTED'));
});

/* ── the happy path, one rung at a time ────────────────────────────────── */

test('a source climbs from a URL to productive, and never skips a rung', () => {
  let s = initialState();
  assert.equal(s.state, 'DISCOVERED');

  s = advance(s, { kind: 'AUDIT', family: 'FORUM', finding: 'PUBLIC_HTML' }).state;
  assert.equal(s.state, 'AUDITED');
  assert.equal(s.family, 'FORUM');

  s = advance(s, { kind: 'ADAPTER_CLAIMED', adapterId: 'forum' }).state;
  assert.equal(s.state, 'IMPLEMENTED');

  s = advance(s, { kind: 'FIXTURE_PASS', adapterId: 'forum' }).state;
  assert.equal(s.state, 'FIXTURE_TESTED');

  s = advance(s, { kind: 'LIVE_FETCH', ok: true, itemsParsed: 8 }).state;
  assert.equal(s.state, 'LIVE_TESTED');

  s = advance(s, { kind: 'SCAN', scanned: 30, useful: 5, language: 'en' }).state;
  assert.equal(s.state, 'PRODUCTIVE');
});

/* ── blocked means blocked ─────────────────────────────────────────────── */

test('an audit that finds a control records BLOCKED, not a problem to solve', () => {
  for (const finding of ['ROBOTS_DISALLOWED', 'LOGIN_REQUIRED', 'ANTI_BOT', 'TERMS_PROHIBIT']) {
    const { state, transition } = advance(initialState(), {
      kind: 'AUDIT', family: 'PROPERTY_PORTAL', finding,
    });
    assert.equal(state.state, 'BLOCKED', `${finding} did not block`);
    assert.match(transition.reason, /defeating a control/);
    assert.equal(findingPermitsAccess(finding), false);
  }
});

test('a successful fetch of a blocked source is a compliance problem, not a promotion', () => {
  /*
   * THE LOAD-BEARING RULE. If a BLOCKED source suddenly answers, something
   * bypassed a control. Recording that as progress would turn a compliance
   * failure into a green row on a dashboard, and nobody would ever look at it
   * again.
   */
  const blocked = advance(initialState(), {
    kind: 'AUDIT', family: 'PROPERTY_PORTAL', finding: 'ANTI_BOT',
  }).state;

  const { state, transition } = advance(blocked, { kind: 'LIVE_FETCH', ok: true, itemsParsed: 40 });
  assert.equal(state.state, 'BLOCKED');
  assert.equal(transition.rejected, true);
  assert.match(transition.reason, /bypassed|human/i);
});

test('nothing else advances a blocked source either', () => {
  const blocked = advance(initialState(), {
    kind: 'AUDIT', family: 'FORUM', finding: 'ROBOTS_DISALLOWED',
  }).state;

  for (const evidence of [
    { kind: 'ADAPTER_CLAIMED', adapterId: 'forum' },
    { kind: 'FIXTURE_PASS', adapterId: 'forum' },
    { kind: 'SCAN', scanned: 100, useful: 40, language: 'en' },
  ]) {
    const { state, transition } = advance(blocked, evidence);
    assert.equal(state.state, 'BLOCKED', `${evidence.kind} moved a blocked source`);
    assert.equal(transition.rejected, true);
  }
});

test('a block lifts only when a fresh audit finds a legitimate route', () => {
  // The site changed, not our willingness to bypass it.
  const blocked = advance(initialState(), {
    kind: 'AUDIT', family: 'PROPERTY_PORTAL', finding: 'LOGIN_REQUIRED',
  }).state;
  const reopened = advance(blocked, {
    kind: 'AUDIT', family: 'PROPERTY_PORTAL', finding: 'API_AVAILABLE',
  }).state;
  assert.equal(reopened.state, 'AUDITED');
  assert.equal(reopened.finding, 'API_AVAILABLE');
});

test('an explicit unblock returns to audit, not to where it was', () => {
  /*
   * A source that changed enough to be unblocked has changed enough to be
   * looked at again. Restoring it to LIVE_TESTED would carry forward a claim
   * about how to read it that is now old.
   */
  let s = reach('PRODUCTIVE');
  s = advance(s, { kind: 'AUDIT', family: 'PROPERTY_PORTAL', finding: 'TERMS_PROHIBIT' }).state;
  assert.equal(s.state, 'BLOCKED');
  s = advance(s, { kind: 'UNBLOCK', reason: 'licence agreed with the operator' }).state;
  assert.equal(s.state, 'AUDITED');
  assert.equal(s.finding, null, 'a stale access finding survived the unblock');
});

/* ── fixtures are not the world ────────────────────────────────────────── */

test('a fixture pass never becomes a live test', () => {
  const s = reach('FIXTURE_TESTED');
  assert.equal(s.state, 'FIXTURE_TESTED');
  const again = advance(s, { kind: 'FIXTURE_PASS', adapterId: 'portal' }).state;
  assert.equal(again.state, 'FIXTURE_TESTED', 'fixtures promoted themselves');
});

test('fixtures cannot advance a source with no adapter', () => {
  for (const at of ['DISCOVERED', 'AUDITED']) {
    const { state, transition } = advance(reach(at), { kind: 'FIXTURE_PASS', adapterId: 'x' });
    assert.equal(state.state, at);
    assert.equal(transition.rejected, true);
  }
});

test('a 200 that parsed nothing is not a live test', () => {
  /*
   * A cookie wall, a consent interstitial and a soft 404 all answer 200 and
   * carry nothing. "The page responded" is not evidence that we can read it.
   */
  const s = reach('FIXTURE_TESTED');
  const { state } = advance(s, { kind: 'LIVE_FETCH', ok: true, itemsParsed: 0 });
  assert.equal(state.state, 'FIXTURE_TESTED');
});

/* ── productivity is measured ──────────────────────────────────────────── */

test('one lucky scan is not productivity', () => {
  const s = reach('LIVE_TESTED');
  const { state, transition } = advance(s, { kind: 'SCAN', scanned: 1, useful: 1, language: 'ka' });
  assert.equal(state.state, 'LIVE_TESTED');
  assert.match(transition.reason, /not yet productive/);
});

test('a firehose with a terrible ratio is not productivity either', () => {
  // The count bar alone would promote this; the rate bar stops it.
  const s = reach('LIVE_TESTED');
  const { state } = advance(s, { kind: 'SCAN', scanned: 5000, useful: 4, language: 'en' });
  assert.equal(state.state, 'LIVE_TESTED');
});

test('productivity needs both enough observations and enough yield', () => {
  const s = reach('LIVE_TESTED');
  const barely = advance(s, {
    kind: 'SCAN', scanned: PRODUCTIVE_MIN_SCANNED, useful: PRODUCTIVE_MIN_USEFUL, language: 'ka',
  }).state;
  assert.equal(barely.state, 'PRODUCTIVE');

  const justUnder = advance(reach('LIVE_TESTED'), {
    kind: 'SCAN', scanned: PRODUCTIVE_MIN_SCANNED - 1, useful: PRODUCTIVE_MIN_USEFUL, language: 'ka',
  }).state;
  assert.equal(justUnder.state, 'LIVE_TESTED');
});

test('scans accumulate, so a source earns productivity over time', () => {
  let s = reach('LIVE_TESTED');
  for (let i = 0; i < 4; i += 1) {
    s = advance(s, { kind: 'SCAN', scanned: 6, useful: 1, language: 'ru' }).state;
  }
  assert.equal(s.scanned, 24);
  assert.equal(s.useful, 4);
  assert.equal(s.state, 'PRODUCTIVE');
});

test('a scan cannot promote a source that has never been read live', () => {
  const { state, transition } = advance(reach('FIXTURE_TESTED'), {
    kind: 'SCAN', scanned: 100, useful: 50, language: 'en',
  });
  assert.equal(state.state, 'FIXTURE_TESTED');
  assert.equal(transition.rejected, true);
  // The counts are still recorded — the evidence is real, the promotion is not.
  assert.equal(state.scanned, 100);
});

/* ── failing, and coming back ──────────────────────────────────────────── */

test('a working source degrades after repeated failures, and not before', () => {
  let s = reach('LIVE_TESTED');
  for (let i = 1; i < DEGRADE_AFTER_FAILURES; i += 1) {
    s = advance(s, { kind: 'LIVE_FETCH', ok: false, reason: 'timeout' }).state;
    assert.equal(s.state, 'LIVE_TESTED', `degraded after only ${i} failure(s)`);
  }
  s = advance(s, { kind: 'LIVE_FETCH', ok: false, reason: 'timeout' }).state;
  assert.equal(s.state, 'DEGRADED');
});

test('recovery returns a source to where it was working', () => {
  // Not to DISCOVERED. A group that went private for a week comes back.
  let s = reach('LIVE_TESTED');
  for (let i = 0; i < DEGRADE_AFTER_FAILURES; i += 1) {
    s = advance(s, { kind: 'LIVE_FETCH', ok: false, reason: '503' }).state;
  }
  assert.equal(s.state, 'DEGRADED');
  s = advance(s, { kind: 'LIVE_FETCH', ok: true, itemsParsed: 5 }).state;
  assert.equal(s.state, 'LIVE_TESTED');
  assert.equal(s.failureCount, 0);
});

test('a source that never worked does not degrade, it just fails', () => {
  let s = reach('IMPLEMENTED');
  for (let i = 0; i < DEGRADE_AFTER_FAILURES + 2; i += 1) {
    s = advance(s, { kind: 'LIVE_FETCH', ok: false, reason: 'dns' }).state;
  }
  assert.equal(s.state, 'IMPLEMENTED', 'a source that was never live became DEGRADED');
});

/* ── retirement ────────────────────────────────────────────────────────── */

test('a retired source is not revived by a successful scan', () => {
  const retired = advance(reach('PRODUCTIVE'), { kind: 'RETIRE', reason: 'provider retired' }).state;
  const { state, transition } = advance(retired, { kind: 'SCAN', scanned: 50, useful: 30, language: 'en' });
  assert.equal(state.state, 'RETIRED');
  assert.equal(transition.rejected, true);
  assert.match(transition.reason, /explicit decision/);
});

test('only a deliberate reopening brings a retired source back', () => {
  const retired = advance(reach('PRODUCTIVE'), { kind: 'RETIRE', reason: 'not worth the slot' }).state;
  const back = advance(retired, { kind: 'UNBLOCK', reason: 'operator asked for it again' }).state;
  assert.equal(back.state, 'AUDITED');
});

/* ── what a state is allowed to do ─────────────────────────────────────── */

test('only proven sources are scanned on a customer\'s budget', () => {
  /*
   * A customer paying for a search should not be funding our first attempt at
   * a new site. DEGRADED is excluded too — it is retried by the back-off
   * schedule, not by somebody's campaign.
   */
  for (const state of SOURCE_LIFECYCLE_STATES) {
    const allowed = state === 'LIVE_TESTED' || state === 'PRODUCTIVE';
    assert.equal(mayScanForCampaign(state), allowed, `${state}`);
    assert.equal(mayDeliverResults(state), allowed, `${state} delivery`);
  }
});

test('a dedicated adapter is earned by measurement, not by enthusiasm', () => {
  const productive = reach('PRODUCTIVE');
  // Parsing fine through the family: no dedicated adapter needed, however
  // good the source is.
  assert.equal(
    shouldGraduateToDedicatedAdapter(productive, { familyParsesPoorly: false }),
    false,
  );
  // Parsing badly, but not enough evidence yet.
  assert.equal(
    shouldGraduateToDedicatedAdapter({ ...productive, scanned: 10, useful: 2 }, { familyParsesPoorly: true }),
    false,
  );
  assert.equal(
    shouldGraduateToDedicatedAdapter({ ...productive, scanned: 200, useful: 40 }, { familyParsesPoorly: true }),
    true,
  );
});

test('an unproven source never graduates, however badly the family parses it', () => {
  assert.equal(
    shouldGraduateToDedicatedAdapter(
      { ...reach('FIXTURE_TESTED'), scanned: 500, useful: 200 },
      { familyParsesPoorly: true },
    ),
    false,
  );
});

/* ── the description never invents a number ────────────────────────────── */

test('every state describes itself without a percentage', () => {
  for (const state of SOURCE_LIFECYCLE_STATES) {
    const text = describeLifecycle({ ...initialState(), state });
    assert.ok(text.length > 5, `${state} has no description`);
    assert.equal(/%/.test(text), false, `${state} claims a percentage`);
  }
  // Productivity reports the two counts it actually has.
  assert.match(describeLifecycle(reach('PRODUCTIVE')), /\d+ useful of \d+ scanned/);
});

/* ── the database agrees with the code ─────────────────────────────────── */

test('the states, families and findings are identical in TypeScript and Postgres', () => {
  /*
   * Three lists, twice each, in two languages. The failure this catches is a
   * new state added in TypeScript, shipped, and rejected by a CHECK
   * constraint on the row that mattered — at which point the writer either
   * throws in production or, worse, is wrapped in a try/catch by somebody in
   * a hurry and the state silently stops being recorded.
   */
  const sql = readFileSync('supabase/migrations/20260925170000_source_lifecycle.sql', 'utf8');
  const listAfter = (marker) => {
    const at = sql.indexOf(marker);
    assert.ok(at > 0, `the migration no longer declares ${marker}`);
    const block = sql.slice(at, sql.indexOf('))', at));
    return [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  };

  assert.deepEqual(listAfter('check (lifecycle in ('), [...SOURCE_LIFECYCLE_STATES].sort());
  assert.deepEqual(listAfter('check (source_family is null or source_family in ('), [...SOURCE_FAMILIES].sort());

  const findings = listAfter('check (access_finding is null or access_finding in (');
  for (const finding of findings) {
    // Every finding the database accepts must be one the code can judge.
    assert.equal(typeof findingPermitsAccess(finding), 'boolean');
  }
  assert.ok(findings.includes('ROBOTS_DISALLOWED'));
  assert.ok(findings.includes('PUBLIC_HTML'));
});

test('the scan gate is the same rule in both places', () => {
  const sql = readFileSync('supabase/migrations/20260925170000_source_lifecycle.sql', 'utf8');
  const fn = sql.slice(sql.indexOf('create or replace function public.source_may_scan_for_campaign'));
  const allowed = [...fn.slice(0, fn.indexOf('$$;')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  const fromCode = SOURCE_LIFECYCLE_STATES.filter(mayScanForCampaign).sort();
  assert.deepEqual(allowed, fromCode);
});

test('a transition always says why, including when nothing moved', () => {
  const s = reach('LIVE_TESTED');
  const { transition } = advance(s, { kind: 'SCAN', scanned: 2, useful: 0, language: 'ka' });
  assert.equal(transition.from, transition.to);
  assert.ok(transition.reason.length > 10, 'a refusal with no reason');
});
