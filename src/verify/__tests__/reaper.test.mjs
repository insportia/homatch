// The WAITING_HUMAN reaper — what it must and must not touch.
//
// A verification that stops because a person did not come back is the one
// terminal state most likely to be described wrongly. It is not a failure of
// the research, and it says nothing whatever about the property; it is the
// customer's own action, or their absence.
//
// These assertions were written alongside a run of the DEPLOYED reaper
// against four disposable rows in production — a stale WAITING_HUMAN, a
// fresh one, a terminal job and a cancelled job — which behaved exactly as
// pinned below. This suite is what stops that behaviour drifting, without
// needing a CAPTCHA, a provider call, or a real human-verification stop to
// occur naturally.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
/** Comments stripped, so prose ABOUT a rule never satisfies the rule. */
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const AGENT = 'supabase/functions/research-agent/index.ts';
const reaper = () => {
  const src = code(AGENT);
  const from = src.indexOf('async function retireAbandonedJobs');
  assert.ok(from > 0, 'the reaper is gone');
  return src.slice(from, src.indexOf('\n}', from));
};

/* ── what it selects ─────────────────────────────────────────────────── */

test('a stale human-verification stop is eligible, a fresh one is not', () => {
  const r = reaper();
  // WAITING_HUMAN is swept ALONGSIDE the live statuses — it is the state a
  // person is expected to resolve, so it needs an expiry that the live
  // statuses do not.
  assert.ok(/\.in\('status', \[\.\.\.DRIVE_LIVE_STATUSES, 'WAITING_HUMAN'\]\)/.test(r),
    'WAITING_HUMAN is no longer swept for expiry');
  // Age is what makes it eligible, and it is measured from creation.
  assert.ok(/\.lt\('created_at', cutoff\)/.test(r), 'there is no age cutoff — a fresh stop could be reaped');
  assert.ok(/DRIVE_MAX_AGE_MS/.test(r), 'the cutoff is not the driver window');
});

test('a terminal or cancelled job is never reaped again', () => {
  const r = reaper();
  // COMPLETE/FAILED are simply not in the status filter, and cancelled is
  // excluded explicitly — cancelling is the customer's decision and must not
  // be rewritten as an expiry.
  assert.ok(!/'COMPLETE'/.test(r) && !/'FAILED'/.test(r.split('update(')[0]),
    'a terminal job is selectable by the reaper');
  assert.ok(/\.is\('cancelled_at', null\)/.test(r), 'a cancelled job can be reaped');
  assert.ok(/\.is\('deleted_at', null\)/.test(r), 'a deleted job can be reaped');
});

test('the sweep is bounded and reports its own failure', () => {
  const r = reaper();
  assert.ok(/\.limit\(DRIVE_BATCH\)/.test(r), 'the reaper sweep is unbounded');
  assert.ok(/reaperError/.test(r) && /if \(reaperError\)/.test(r),
    'the reaper swallows its query error');
});

/* ── what it writes ──────────────────────────────────────────────────── */

test('an expired human verification is marked as expiry, not as abandonment', () => {
  const r = reaper();
  assert.ok(/HUMAN_VERIFICATION_EXPIRED/.test(r), 'expiry is not distinguished');
  assert.ok(/RESEARCH_ABANDONED_BEFORE_COMPLETION/.test(r), 'abandonment is not distinguished');
  assert.ok(/j\.status === 'WAITING_HUMAN'/.test(r),
    'the two are not chosen between — a timeout would read as abandoned research');
});

test('reaping preserves the evidence already collected', () => {
  const r = reaper();
  const update = r.slice(r.indexOf('update({'));
  // The write touches status/stage/error/claim/updated_at and nothing else.
  assert.ok(!/result_json/.test(update), 'the reaper discards collected evidence');
  assert.ok(!/evidence_bundle/.test(update), 'the reaper discards the evidence bundle');
  assert.ok(/driver_claimed_at: null/.test(update), 'the reaper leaves a stale claim behind');
});

test('a reaped job is idempotent — it can never be selected twice', () => {
  const r = reaper();
  // It is written to FAILED, and FAILED is not in the selection filter, so a
  // second pass cannot see it. That is what makes repeat ticks harmless.
  assert.ok(/status: 'FAILED'/.test(r), 'the reaped job does not reach a terminal status');
  const selection = r.slice(0, r.indexOf('for (const j of'));
  assert.ok(!/'FAILED'/.test(selection), 'FAILED is selectable, so reaping would repeat forever');
});

/* ── what it must never cause ────────────────────────────────────────── */

test('an expired verification cannot be resurrected by the driver', () => {
  const agent = code(AGENT);
  const sweep = agent.slice(agent.indexOf('async function driveLiveJobs'));
  // The live sweep only takes CREATED/RUNNING, so a FAILED expiry is
  // invisible to it.
  assert.ok(/\.in\('status', DRIVE_LIVE_STATUSES\)/.test(sweep),
    'the live sweep takes statuses beyond CREATED/RUNNING');
  assert.ok(/const DRIVE_LIVE_STATUSES = \['CREATED', 'RUNNING'\]/.test(agent),
    'the live statuses now include a terminal or waiting state');
});

test('an expired verification cannot be offered as an active reattach', () => {
  // VerifyPage looks for a job to reattach to when the URL names none. A
  // reaped job must fail that predicate on BOTH counts: its status is
  // terminal, and it is older than the window.
  const page = code('src/pages/VerifyPage.tsx').replace(/\s+/g, ' ');
  assert.ok(/\.in\('status',\['CREATED','RUNNING','WAITING_HUMAN'\]\)/.test(page),
    'the reattach predicate changed — a terminal job could be offered');
  assert.ok(/\.gt\('created_at',new Date\(Date\.now\(\)-6\*60\*60\*1000\)/.test(page),
    'the reattach window is gone — an ancient job could capture the page');
});

test('expiry is never presented to the customer as a property problem', () => {
  // The marker is internal and must not reach the wire; the customer gets a
  // safe enum and localized copy instead.
  const agent = code(AGENT);
  assert.ok(/INTERNAL_TERMINAL_MARKER/.test(agent), 'internal markers reach the customer verbatim');
  assert.ok(/terminalReason.*'EXPIRED'/.test(agent), 'expiry is not carried as a safe reason');

  const bundle = read('src/i18n/translations.ts');
  const copies = bundle.split('verify_err_human_expired: ').slice(1);
  assert.equal(copies.length, 6, 'the expiry copy is not defined in all six languages');
  for (const c of copies) {
    const line = c.slice(0, 500);
    assert.ok(!/(risk|რისკ|риск|problem|პრობლემ|fail|წარუმატებ)/i.test(line),
      'the expiry message frames a timeout as a property problem or a failure');
  }
});
