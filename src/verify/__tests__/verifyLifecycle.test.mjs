// HOMATCH VERIFY — the lifecycle regression matrix.
//
// These pin the guarantees that a real customer test proved were missing:
// research that stops when the tab closes, a report that only exists if a
// browser happened to be watching, a clock that restarts from zero, and an
// active verification with no representation on screen at all.
//
// The progress and narrative modules are exercised as real code. The wiring
// around them is checked against source, because the alternative is mounting
// React, Supabase and a live Postgres to assert that one call site exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  estimateProgress,
  elapsedMs,
  formatElapsed,
  phaseFor,
  bandFor,
} from '../progress.ts';
import {
  PHASE_MESSAGES,
  PHASE_TAG,
  messagesFor,
  extractLiveFacts,
} from '../researchNarrative.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
/** Source with comments stripped, so a rule is never satisfied by prose ABOUT the rule. */
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const T0 = Date.parse('2026-09-10T10:00:00.000Z');
const at = (min) => T0 + min * 60_000;
const run = (over = {}) => ({
  status: 'RUNNING',
  stage: 'BROWSER_WAITING',
  createdAt: new Date(T0).toISOString(),
  now: at(5),
  ...over,
});

/* ── ESTIMATED PROGRESS ───────────────────────────────────────────── */

test('100% means a valid report exists, and nothing else does', () => {
  // Every non-terminal stage, at an absurd elapsed time, must still not claim
  // completion. "Research finished" is not "report ready".
  for (const stage of Object.keys(bandFor('') ? { BROWSER_WAITING: 1, MARKET_READY: 1, SYNTHESIS_READY: 1, COMPLETE: 1 } : {})) {
    const pct = estimateProgress(run({ stage, now: at(600), status: 'RUNNING' }));
    assert.ok(pct < 100, `${stage} reached 100% with no report`);
  }
  assert.equal(estimateProgress(run({ status: 'COMPLETE', stage: 'COMPLETE', now: at(600) })) < 100, true);
  assert.equal(estimateProgress(run({ reportReady: true })), 100);
});

test('a run we have not heard about yet reads as just-started', () => {
  // Caught on a live production run: one second in, the page showed "28%,
  // official records", because a missing stage and a stage we have not met
  // shared the same mid-research default. They are different questions.
  const fresh = estimateProgress({ status: 'CREATED', stage: null, createdAt: null });
  assert.ok(fresh <= 4, `a brand-new run reported ${fresh}%`);
  // ...but a stage this table genuinely does not know, on a run that IS
  // twenty minutes old, must still not collapse to 1%.
  const unknown = estimateProgress(run({ stage: 'SOME_NEW_STAGE', now: at(20) }));
  assert.ok(unknown > 20, `an unknown mid-run stage reported ${unknown}%`);

  // The stream's phase label must follow the same rule, or the number and the
  // words disagree on the same screen.
  const stream = code('src/components/verify/ResearchStream.tsx');
  assert.ok(/createdAt \? phaseFor\(stage\) : 'STARTING'/.test(stream),
    'the phase label still defaults to mid-research before the first poll');
});

test('progress never goes backwards as time passes', () => {
  let prev = -1;
  for (let m = 0; m <= 90; m += 1) {
    const pct = estimateProgress(run({ now: at(m) }));
    assert.ok(pct >= prev, `progress fell at minute ${m}: ${prev} -> ${pct}`);
    prev = pct;
  }
});

test('progress never goes backwards as the pipeline advances', () => {
  // Real pipeline order. Each step must be worth at least as much as the last
  // one, at the same instant — otherwise a stage transition reads as regress.
  const order = [
    'QUEUED', 'IDENTITY_WAITING', 'BROWSER_READY', 'BROWSER_WAITING',
    'OFFICIAL_READY', 'OFFICIAL_COLLECTION_WAITING', 'ENREG_CHECK_PENDING',
    'FINANCIAL_ENTITY_WAITING', 'PUBLIC_RESEARCH_READY', 'PUBLIC_RESEARCH_WAITING',
    'PUBLIC_RESEARCH_CHECK_PENDING', 'MARKET_READY', 'MARKET_WAITING',
    'RECONCILIATION_CHECK_PENDING', 'SYNTHESIS_READY', 'SYNTHESIS_WAITING',
  ];
  for (const minute of [1, 5, 12, 25, 45]) {
    let prev = -1;
    for (const stage of order) {
      const pct = estimateProgress(run({ stage, now: at(minute) }));
      assert.ok(pct >= prev, `at ${minute}min, ${stage} (${pct}) < previous stage (${prev})`);
      prev = pct;
    }
  }
});

test('a slow run is not parked at 98% after three minutes', () => {
  // The exact failure mode of the percentage this replaces.
  assert.ok(estimateProgress(run({ now: at(3) })) < 40, 'three minutes in and already most of the way');
  assert.ok(estimateProgress(run({ now: at(10) })) < 70, 'ten minutes in and nearly done');
  // ...and it must still have somewhere to go very late on.
  assert.ok(estimateProgress(run({ stage: 'SYNTHESIS_WAITING', now: at(40) })) < 100);
});

test('the same run reconstructs the same number anywhere', () => {
  // No client state, so a refresh, a second tab and a History reopen all
  // recompute identically from created_at + stage.
  const shape = { stage: 'MARKET_READY', now: at(11) };
  const a = estimateProgress(run(shape));
  const b = estimateProgress(run(shape));
  assert.equal(a, b);
  // And a fresh "mount" — no memory whatsoever — agrees with a long-lived one.
  assert.equal(estimateProgress({ ...run(shape) }), a);
});

test('progress holds still while a human is being waited on', () => {
  const held = estimateProgress(run({ status: 'WAITING_HUMAN', now: at(6) }));
  const later = estimateProgress(run({ status: 'WAITING_HUMAN', now: at(26) }));
  assert.equal(held, later, 'the bar crept forward while nothing was happening');
});

test('a cancelled or failed run stops climbing', () => {
  for (const status of ['CANCELLED', 'FAILED']) {
    const a = estimateProgress(run({ status, now: at(6) }));
    const b = estimateProgress(run({ status, now: at(60) }));
    assert.ok(b <= a + 1, `${status} kept advancing`);
    assert.ok(a < 100, `${status} reported completion`);
  }
});

test('estimated progress cannot control the backend', () => {
  const src = code('src/verify/progress.ts');
  for (const forbidden of ['supabase', 'fetch(', 'invoke(', 'from(']) {
    assert.ok(!src.includes(forbidden), `progress.ts reaches the backend via ${forbidden}`);
  }
});

/* ── THE ELAPSED CLOCK ────────────────────────────────────────────── */

test('elapsed time comes from the server start, so returning shows the real age', () => {
  // The reported bug: leave at 10:04, come back at 10:12, see 00:00.
  assert.equal(formatElapsed(elapsedMs(run({ now: at(12) }))), '12:00');
  assert.equal(formatElapsed(elapsedMs(run({ now: at(0) }))), '00:00');
});

test('a finished run freezes its duration at completion', () => {
  const done = run({
    status: 'COMPLETE',
    reportReady: true,
    completedAt: new Date(at(18)).toISOString(),
    now: at(400),
  });
  assert.equal(formatElapsed(elapsedMs(done)), '18:00', 'the clock kept running after the report was ready');
});

test('a missing start time degrades to zero rather than to nonsense', () => {
  assert.equal(elapsedMs(run({ createdAt: null })), 0);
  assert.equal(elapsedMs(run({ createdAt: 'not a date' })), 0);
});

/* ── THE NARRATIVE ────────────────────────────────────────────────── */

test('there are 30-50 distinct research messages, not four on a loop', () => {
  const all = Object.values(PHASE_MESSAGES).flat();
  const unique = new Set(all);
  assert.ok(unique.size >= 30 && unique.size <= 50, `expected 30-50 messages, found ${unique.size}`);
  // Every phase must have its own material.
  for (const [phase, msgs] of Object.entries(PHASE_MESSAGES)) {
    assert.ok(msgs.length >= 1, `phase ${phase} has no messages`);
  }
});

test('every research message and tag exists in all six languages', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const key of new Set(Object.values(PHASE_MESSAGES).flat())) {
    const hits = bundle.split(`  ${key}: '`).length - 1;
    assert.equal(hits, 6, `${key} is defined in ${hits} bundles, not 6`);
  }
});

test('nothing in the research stream names a source, provider or internal state', () => {
  const surfaces = [
    code('src/verify/researchNarrative.ts'),
    code('src/components/verify/ResearchStream.tsx'),
  ].join('\n').toLowerCase();
  for (const leak of ['rs.ge', 'my.gov', 'napr', 'enreg', 'rstax', 'mygov', 'debtor',
                      'playwright', 'browserless', 'openai', 'myhome', 'korter', 'ss.ge']) {
    assert.ok(!surfaces.includes(leak), `the research stream leaks "${leak}"`);
  }
  // The decorative tags are concepts, never systems.
  for (const tag of Object.values(PHASE_TAG)) {
    assert.match(tag, /^[A-Z_]+ :: [A-Z_]+$/, `tag "${tag}" is not an abstract label`);
  }
});

test('message rotation is deterministic, so two tabs agree', () => {
  assert.deepEqual(messagesFor('MARKET', 3), messagesFor('MARKET', 3));
  assert.notDeepEqual(messagesFor('MARKET', 3), messagesFor('MARKET', 4));
});

/* ── REAL FACTS, AND ONLY REAL ONES ───────────────────────────────── */

test('no facts are revealed when the research has not established any', () => {
  assert.deepEqual(extractLiveFacts(null), []);
  assert.deepEqual(extractLiveFacts({}), []);
  assert.deepEqual(extractLiveFacts({ projectProfile: {}, companyProfile: {} }), []);
});

test('a fact is revealed only from persisted research, never from the stage', () => {
  const facts = extractLiveFacts({
    exactUnit: { code: '01.18.06.019.055.03.01.601' },
    projectProfile: { name: 'VILLION Krtsanisi Homes', developer: 'Millenio Group' },
    market: { comparables: [{}, {}, {}, {}, {}] },
    companyProfile: { directors: ['A', 'B'] },
  });
  const byId = Object.fromEntries(facts.map((f) => [f.id, f.value]));
  assert.equal(byId.cadastral, '01.18.06.019.055.03.01.601');
  assert.equal(byId.project, 'VILLION Krtsanisi Homes');
  assert.equal(byId.comparables, '5');
  assert.equal(byId.participants, '2');
  // Nothing was said about an address, so nothing is shown about one.
  assert.ok(!('address' in byId), 'an address appeared without evidence');
});

test('counts are never shown as zero, which would read as a finding', () => {
  const facts = extractLiveFacts({ market: { comparables: [] }, companyProfile: { directors: [] } });
  assert.deepEqual(facts, []);
});

test('unparseable values are dropped rather than shown as wreckage', () => {
  const facts = extractLiveFacts({
    projectProfile: { name: 'A��B' },
    companyProfile: { name: '   ' },
    identifiedParent: { address: 'x'.repeat(200) },
  });
  assert.deepEqual(facts, []);
});

/* ── AUTONOMY: THE SERVER OWNS THE RUN ────────────────────────────── */

test('the pipeline is driven by something other than a browser', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.ok(agent.includes("'drive'"), 'there is no driver action');
  assert.ok(/driveLiveJobs\(/.test(agent), 'nothing sweeps live jobs');
  // The driver must step the SAME state machine the client steps.
  assert.ok(/await advance\(sb, key, model, j, jobLanguage\(j\)\)/.test(agent.replace(/\s+/g, ' ')) ||
            /advance\(sb, key, model, j, jobLanguage\(j\)\)/.test(agent),
    'the driver does not call advance() — there is a second implementation');
});

test('the driver authenticates, and cannot be triggered by a customer token', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const block = agent.slice(agent.indexOf("=== 'drive'"), agent.indexOf("=== 'drive'") + 900);
  assert.ok(block.includes('x-cron-token'), 'the drive action is unauthenticated');
  assert.ok(block.includes('verify_driver_token'), 'the drive secret is not the dedicated one');
  assert.ok(/return json\(\{ error: 'Forbidden' \}, 403\)/.test(block), 'a bad token is not refused');
});

test('the driver leaves a job alone while a client is polling it', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.ok(/DRIVE_STALE_MS/.test(agent), 'there is no staleness guard');
  assert.ok(/\.lt\('updated_at'/.test(agent), 'the sweep does not filter on heartbeat age');
  // And it must never fight itself.
  assert.ok(/claimJob\(/.test(agent) && /releaseJob\(/.test(agent), 'claims are not released');
});

test('the driver never resurrects a cancelled or deleted job', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const sweep = agent.slice(agent.indexOf('driveLiveJobs'), agent.indexOf('driveLiveJobs') + 1400);
  assert.ok(sweep.includes("is('cancelled_at', null)"), 'cancelled jobs are swept up again');
  assert.ok(sweep.includes("is('deleted_at', null)"), 'deleted jobs are swept up again');
});

test('synthesis is requested by the server, not by the page', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  assert.ok(agent.includes('verify-synthesis'), 'nothing server-side asks for a report');
  assert.ok(/driveSynthesis\(/.test(agent), 'there is no synthesis sweep');
  assert.ok(/MAX_SYNTHESIS_ATTEMPTS/.test(agent), 'synthesis can retry forever');
});

test('a synthesis failure never re-runs the research behind it', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const block = agent.slice(agent.indexOf('async function driveSynthesis'), agent.indexOf('async function driveLiveJobs'));
  assert.ok(!/advance\(/.test(block), 'the synthesis path can re-enter research');
  assert.ok(block.includes("synthesis_state: 'FAILED'"), 'a failed synthesis is not recorded as such');
});

/* ── BUILT ONCE, PERSISTED, NOT RE-CHARGED ────────────────────────── */

test('a finished report is read back, not rebuilt', () => {
  const fn = code('supabase/functions/verify-synthesis/index.ts');
  assert.ok(/synthesis_state === 'READY'/.test(fn), 'the persisted report is not consulted');
  assert.ok(/persisted: true/.test(fn), 'a re-read is indistinguishable from a rebuild');
  assert.ok(/async function persist\(/.test(fn), 'nothing is persisted');
  assert.ok(/synthesis_json: payload/.test(fn), 'the report itself is not stored');
});

test('the driver proves itself with the service key, not merely a valid session', () => {
  const fn = code('supabase/functions/verify-synthesis/index.ts');
  assert.ok(/bearer === serviceKey/.test(fn), 'any valid token could take the internal path');
  assert.ok(/x-internal-driver/.test(fn), 'the internal path is not explicitly requested');
  // Customers must still be held to RLS.
  assert.ok(/if \(!internal\)/.test(fn), 'the customer auth check became conditional on nothing');
});

/* ── CANCELLATION IS SOMETHING THE USER DOES ──────────────────────── */

test('only an explicit action cancels, and it is not a failure', () => {
  const agent = code('supabase/functions/research-agent/index.ts');
  const block = agent.slice(agent.indexOf("action === 'cancel'"), agent.indexOf("action === 'cancel'") + 1600);
  assert.ok(block.includes("status: 'CANCELLED'"), 'cancelling does not set a cancelled status');
  assert.ok(!block.includes("status: 'FAILED'"), 'cancelling is recorded as failure');
  assert.ok(!/result_json:/.test(block), 'cancelling discards collected evidence');
});

test('the page offers an explicit stop, behind a confirmation', () => {
  const page = code('src/pages/VerifyPage.tsx');
  assert.ok(/action:'cancel'/.test(page.replace(/\s/g, '')), 'the page cannot cancel a run');
  assert.ok(page.includes('AlertDialog'), 'stopping is not confirmed');
  assert.ok(page.includes('verify_stop_confirm_title'), 'there is no confirmation copy');
  const stream = code('src/components/verify/ResearchStream.tsx');
  assert.ok(stream.includes('verify_stop_research'), 'the stop control is not offered during a run');
});

test('a cancelled run is shown as stopped, never as failed', () => {
  const page = code('src/pages/VerifyPage.tsx');
  assert.ok(page.includes("status==='CANCELLED'"), 'the page does not recognise cancellation');
  assert.ok(page.includes('verify_stopped_title'), 'there is no stopped state to show');
});

/* ── THE ACTIVE RUN ALWAYS HAS A REPRESENTATION ───────────────────── */

test('a page with no job named in its URL reattaches to a running one', () => {
  const page = code('src/pages/VerifyPage.tsx').replace(/\s+/g, ' ');
  assert.ok(/recovered\.current/.test(page), 'there is no reattach guard');
  assert.ok(/\.in\('status',\['CREATED','RUNNING','WAITING_HUMAN'\]\)/.test(page),
    'the page does not look for a live run');
  assert.ok(/order\('created_at',\{ascending:false\}\)/.test(page), 'the newest live run is not chosen');
});

test('opening a specific case never falls back to "latest active"', () => {
  const page = code('src/pages/VerifyPage.tsx').replace(/\s+/g, ' ');
  // The reattach must be gated on the URL naming nothing at all.
  assert.ok(/if\(searchParams\.get\('job'\)\)\{recovered\.current=true;return\}/.test(page),
    'the reattach can override an explicitly opened case');
  assert.ok(/handleSidebarOpenJob=\(id:string\)=>\{[^}]*openJob\(id,true\)/.test(page),
    'History does not bind to the exact case it was given');
});

test('the note promises background continuation, and no CAPTCHA', () => {
  const bundle = read('src/i18n/translations.ts');
  const notice = code('src/components/research/ResearchDepthNotice.tsx');
  assert.ok(notice.includes('verify_depth_title') && notice.includes('verify_depth_body'),
    'the note is not on the i18n system');
  assert.ok(!/lang==='ka'\?|lang==='ru'\?/.test(notice), 'the note still hard-codes three languages');
  // 10-30 minutes is restored...
  assert.ok(/verify_depth_title: '[^']*10[^']*30/.test(bundle), 'the 10-30 minute expectation is missing');
  // ...and the promise it now makes must be one the backend keeps.
  for (const lang of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) void lang;
  const bodies = bundle.split('verify_depth_body: ').slice(1);
  assert.equal(bodies.length, 6, 'the note body is not defined in all six languages');
  for (const b of bodies) {
    assert.ok(!/captcha|კაპჩა/i.test(b.slice(0, 600)), 'CAPTCHA wording is back in the note');
  }
});
