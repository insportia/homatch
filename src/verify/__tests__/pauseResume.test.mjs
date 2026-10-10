// Stop & resume: where a paused investigation continues, how a finished job's
// budget closes, the optional-stage budget guard, and what the customer sees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPausable, resumeTarget, settlementOutcome, optionalStageFits, publicBilling } from '../pauseResume.ts';

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
  assert.deepEqual(b, { state: 'PAUSED', authorized: 25, used: 8, remaining: 17, charged: 8, live: false, calculating: false, lastReturned: 17, lastCharged: 8 });
  assert.equal(publicBilling(null), null);
  const json = JSON.stringify(b).toLowerCase();
  for (const word of ['vat', 'margin', 'cogs', 'cost', 'landed', 'contingency']) assert.ok(!json.includes(word), word);
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
  assert.match(src, /p_idempotency_key: `verify:\$\{id\}:r\$\{n \+ 1\}`/);
  // A continuation is applied once (compare-and-set on status + resume_count).
  assert.match(src, /\.eq\('status', 'PAUSED'\)\.eq\('resume_count', n\)/);
  // Ended jobs are settled by the driver sweep.
  assert.match(src, /await settleVerifyBudgets\(sb\);/);
});
