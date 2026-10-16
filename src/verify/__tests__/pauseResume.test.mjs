// Stop & resume: where a paused investigation continues, how a finished job's
// budget closes, the optional-stage budget guard, and what the customer sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPausable, resumeTarget, settlementOutcome, optionalStageFits, publicBilling, budgetHold } from '../pauseResume.ts';

const agent = () => readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');

test('only a live investigation can be stopped', () => {
  for (const s of ['CREATED', 'RUNNING', 'WAITING_HUMAN']) assert.equal(isPausable(s), true, s);
  for (const s of ['PAUSED', 'COMPLETE', 'FAILED', 'CANCELLED', undefined]) assert.equal(isPausable(s), false, String(s));
});

test('stopped during AI analysis: a cancelled stage is relaunched, a finished one is re-read (never paid twice)', () => {
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'MARKET_WAITING' }), { status: 'CREATED', stage: 'MARKET_READY', requeueOfficial: false, restartBrowser: false });
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'IDENTITY_WAITING' }).stage, 'QUEUED');
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'SYNTHESIS_WAITING' }).stage, 'SYNTHESIS_READY');
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'PUBLIC_RESEARCH_WAITING', responseKept: true }), { status: 'RUNNING', stage: 'PUBLIC_RESEARCH_WAITING', requeueOfficial: false, restartBrowser: false });
});

test('stopped during official research: queue mode continues only unfinished tasks; legacy restarts the browser job', () => {
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'BROWSER_WAITING', queue: true }), { status: 'RUNNING', stage: 'BROWSER_WAITING', requeueOfficial: true, restartBrowser: false });
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'BROWSER_WAITING' }), { status: 'CREATED', stage: 'BROWSER_READY', requeueOfficial: false, restartBrowser: true });
  // Stopped while a CAPTCHA was being handled for the official job.
  assert.equal(resumeTarget({ status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED', queue: true, captchaReturnStage: 'BROWSER_WAITING' }).requeueOfficial, true);
  // ... or for a registry lookup: the lookup goes back to the front of its queue.
  assert.equal(resumeTarget({ status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED', captchaReturnStage: 'FINANCIAL_ENTITY_WAITING' }).stage, 'FINANCIAL_ENTITY_WAITING');
  assert.equal(resumeTarget({ status: 'RUNNING', stage: 'FINANCIAL_ENTITY_WAITING' }).stage, 'FINANCIAL_ENTITY_WAITING');
});

test('stopped between stages: continues exactly there', () => {
  assert.deepEqual(resumeTarget({ status: 'CREATED', stage: 'MARKET_READY' }), { status: 'CREATED', stage: 'MARKET_READY', requeueOfficial: false, restartBrowser: false });
  assert.deepEqual(resumeTarget({ status: 'CREATED', stage: 'RECONCILIATION_CHECK_PENDING' }).stage, 'RECONCILIATION_CHECK_PENDING');
});

test('settlement: report delivered → charged; system failure → released; stop → incurred charged', () => {
  const o = { maxSynthesisAttempts: 4, synthesisGraceMs: 7_200_000, now: Date.parse('2026-10-10T12:00:00Z') };
  assert.equal(settlementOutcome({ status: 'COMPLETE', synthesis_state: 'READY' }, o), 'COMPLETE');
  assert.equal(settlementOutcome({ status: 'COMPLETE', synthesis_state: 'PENDING', completed_at: '2026-10-10T11:50:00Z' }, o), null, 'the report is still being written');
  assert.equal(settlementOutcome({ status: 'COMPLETE', synthesis_state: 'FAILED', synthesis_attempts: 4 }, o), 'SYSTEM_FAILED', 'no report, no charge');
  assert.equal(settlementOutcome({ status: 'COMPLETE', synthesis_state: 'FAILED', synthesis_attempts: 2, completed_at: '2026-10-10T11:50:00Z' }, o), null, 'a retry is still due');
  assert.equal(settlementOutcome({ status: 'COMPLETE', synthesis_state: 'PENDING', completed_at: '2026-10-10T08:00:00Z' }, o), 'SYSTEM_FAILED');
  assert.equal(settlementOutcome({ status: 'FAILED' }, o), 'SYSTEM_FAILED');
  assert.equal(settlementOutcome({ status: 'PAUSED' }, o), 'STOPPED');
  // A continuation in progress (budget opened after the pause) is not released under it...
  assert.equal(settlementOutcome({ status: 'PAUSED', paused_at: '2026-10-10T11:00:00Z' }, { ...o, openSessionAt: '2026-10-10T11:58:00Z' }), null);
  // ...unless it never got the job running.
  assert.equal(settlementOutcome({ status: 'PAUSED', paused_at: '2026-10-10T11:00:00Z' }, { ...o, openSessionAt: '2026-10-10T11:40:00Z' }), 'STOPPED');
  assert.equal(settlementOutcome({ status: 'CANCELLED' }, o), 'STOPPED');
  assert.equal(settlementOutcome({ status: 'RUNNING' }, o), null);
});

test('optional paid stage runs only when the remaining budget covers its ceiling', () => {
  assert.equal(optionalStageFits({ remaining: 20, usageState: 'LIVE' }, 17.02), true);
  assert.equal(optionalStageFits({ remaining: 9.5, usageState: 'LIVE' }, 17.02), false);
  assert.equal(optionalStageFits(null, 17.02), true, 'no budget (billing off): unchanged behaviour');
});

test('the customer sees used / remaining / returned — never costs, VAT or margins', () => {
  const b = publicBilling({
    state: 'PAUSED', authorizedTotal: '25.0000', chargedTotal: '8.0000', used: '8.0000', remaining: '17.0000', usageState: 'SETTLED',
    lastSession: { outcome: 'STOPPED', charged: '8.0000', released: '17.0000' }, budgetGuard: false, sessions: 1,
  });
  assert.deepEqual(b, { state: 'PAUSED', authorized: 25, used: 8, remaining: 17, charged: 8, live: false, calculating: false, lastReturned: 17, lastCharged: 8, authorizations: null, increment: null, incrementUsdCents: null, maxBudget: null, canExtend: false, hold: null });
  const x = publicBilling({ state: 'PAUSED', authorizedTotal: 50, chargedTotal: 41, used: 41, remaining: 9, authorizations: 2, increment: 25, maxBudget: 100, canExtend: true }, { reason: 'BUDGET' });
  assert.equal(x.authorizations, 2);
  assert.equal(x.canExtend, true);
  assert.equal(x.hold, 'APPROVAL', 'the +25 question is the server\'s, never inferred by the page');
  assert.equal(publicBilling(null), null);
  const json = JSON.stringify(b).toLowerCase();
  for (const word of ['vat', 'margin', 'cogs', 'cost', 'landed', 'contingency']) assert.ok(!json.includes(word), word);
});

test('budget hold: approval, the 100 maximum, or an ordinary stop', () => {
  assert.equal(budgetHold({ reason: 'BUDGET' }), 'APPROVAL');
  assert.equal(budgetHold({ reason: 'BUDGET_LIMIT' }), 'LIMIT');
  assert.equal(budgetHold({ status: 'RUNNING', stage: 'MARKET_WAITING' }), null);
  assert.equal(budgetHold(null), null);
  // A job held before FINANCIAL_ENTITY continues by re-reading its queue (no worker job yet).
  assert.deepEqual(resumeTarget({ status: 'RUNNING', stage: 'FINANCIAL_ENTITY_WAITING', reason: 'BUDGET' }), { status: 'RUNNING', stage: 'FINANCIAL_ENTITY_WAITING', requeueOfficial: false, restartBrowser: false });
  // Held before MARKET: continues at MARKET_READY, nothing earlier is repeated.
  assert.deepEqual(resumeTarget({ status: 'CREATED', stage: 'MARKET_READY', reason: 'BUDGET' }), { status: 'CREATED', stage: 'MARKET_READY', requeueOfficial: false, restartBrowser: false });
  // Awaiting approval holds nothing: a paused job's open session is closed by the sweep.
  assert.equal(settlementOutcome({ status: 'PAUSED' }, { maxSynthesisAttempts: 4, synthesisGraceMs: 1 }), 'STOPPED');
});

test('research-agent: every chargeable stage asks the budget gate first; only an explicit approval extends', () => {
  const src = agent();
  const adv = src.slice(src.indexOf('async function advance('), src.indexOf("const a = String(j.stage || '').match(/^(IDENTITY|OFFICIAL_COLLECTION|PUBLIC_RESEARCH|MARKET|SYNTHESIS)_WAITING$/);\n    if (!a || !j.response_id) return;"));
  for (const [gate, call] of [['IDENTITY', "launch(sb, k, m, j, 'IDENTITY', l)"], ['OFFICIAL', 'startBrowser(sb, j)'], ['OFFICIAL_COLLECTION', "launch(sb, k, m, j, 'OFFICIAL_COLLECTION', l)"], ['PUBLIC_RESEARCH', "launch(sb, k, m, j, 'PUBLIC_RESEARCH', l)"], ['MARKET', "launch(sb, k, m, j, 'MARKET', l)"], ['SYNTHESIS', "launch(sb, k, m, j, 'SYNTHESIS', l)"]]) {
    const g = adv.indexOf(`holdForBudget(sb, j, '${gate}')`);
    assert.ok(g > 0 && g < adv.indexOf(call), `${gate} is gated before it launches`);
  }
  const fq = src.slice(src.indexOf('async function processFinancialQueue('), src.indexOf('async function pollFinancialEntity('));
  assert.ok(fq.indexOf("holdForBudget(sb, { ...j, result_json: prior }, 'FINANCIAL_ENTITY'") < fq.indexOf('return startFinancialEntity('));
  assert.match(src, /budgetGate\(sb, j\.id, 'DEVELOPER_ADS'\)/);
  // Held = PAUSED with the reason, conditional on the row, then the session is closed (nothing held).
  const hold = src.slice(src.indexOf('async function holdForBudget('), src.indexOf('async function holdForBudget(') + 1400);
  assert.match(hold, /reason: decision === 'AWAIT' \? 'BUDGET' : 'BUDGET_LIMIT'/);
  assert.match(hold, /\.eq\('status', j\.status\)\.eq\('stage', j\.stage\)/);
  assert.match(hold, /closeBilling\(sb, j\.id, 'STOPPED'\)/);
  // Continue: the approval names its screen; a held job never continues without it; the limit never extends.
  assert.match(src, /p_extend: extend, p_expected_authorizations: extend \? expected : null/);
  assert.match(src, /held === 'BUDGET' && !extend/);
  assert.match(src, /held === 'BUDGET_LIMIT'/);
  assert.doesNotMatch(src, /approveExtraCredits|p_extra_credits/);
});

test('research-agent: reserves before work, stops cooperatively, never advances a paused job', () => {
  const src = agent();
  const start = src.slice(src.indexOf('RESERVE BEFORE ANY BILLABLE WORK'), src.indexOf('RESERVE BEFORE ANY BILLABLE WORK') + 1600);
  assert.match(start, /verify_billing_open/);
  assert.ok(start.indexOf('verify_billing_open') < start.indexOf('advanceExclusive'), 'reservation precedes the first step');
  assert.match(src, /\['COMPLETE', 'FAILED', 'WAITING_HUMAN', 'CANCELLED', 'PAUSED'\]\.includes\(j\.status\)/);
  // The stop intent is checked before and after every step.
  const ex = src.slice(src.indexOf('async function advanceExclusive('), src.indexOf('async function advance('));
  assert.equal((ex.match(/pauseRequested\(sb, j\.id\)/g) || []).length, 2);
  // Continue reserves only what is left (SQL), with a key per continuation.
  assert.match(src, /p_idempotency_key: `verify:\$\{id\}:r\$\{n \+ 1\}:s\$\{seq \+ 1\}`/);
  assert.match(src, /\/\/ A continuation never runs without an open budget\.\n\s+if \(!o\?\.ok\) \{/);
  // A continuation is applied once (compare-and-set on status + resume_count).
  assert.match(src, /\.eq\('status', 'PAUSED'\)\.eq\('resume_count', n\)/);
  // Ended jobs are settled by the driver sweep.
  assert.match(src, /await settleVerifyBudgets\(sb\);/);
});
