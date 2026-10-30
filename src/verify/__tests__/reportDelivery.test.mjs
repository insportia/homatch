// Research completion is not report delivery (stabilization 2026-10-30).
//
// Production 2026-10-29: verify-synthesis failed to boot; job 674df06e
// (cadastral 01.16.06.039.039) read COMPLETE while synthesis_state was FAILED
// and no report existed. A report is DELIVERED only when synthesis_state =
// READY and synthesis_json exists — on the customer page, the history list,
// the Admin views, billing (verify_billing_close COMPLETE commits the trial /
// plan use) and the "Verify completed" notification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  reportDeliveryState, isReportDelivered, reportFailureReason, looksLikeBootError,
  REPORT_MAX_ATTEMPTS, REPORT_SETTLE_GRACE_MS,
} from '../reportDelivery.ts';
import { settlementOutcome } from '../pauseResume.ts';
import { verifyCustomerState } from '../completion.ts';
import { verifyMirror } from '../../jobs/verifyMirror.ts';

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const RA = read('supabase/functions/research-agent/index.ts');
const VS = read('supabase/functions/verify-synthesis/index.ts');
const SQL = read('supabase/migrations/20261208130000_verify_report_delivery.sql');

const COMPLETED_AT = '2026-10-29T10:00:00.000Z';
const NOW = Date.parse('2026-10-29T10:05:00.000Z');
const job = (over = {}) => ({ status: 'COMPLETE', synthesis_state: 'PENDING', synthesis_attempts: 1, completed_at: COMPLETED_AT, ...over });

/* ── the rule ───────────────────────────────────────────────────────────── */

test('the incident job: research COMPLETE, synthesis FAILED after every attempt, no report → FAILED, never DELIVERED', () => {
  assert.equal(reportDeliveryState(job({ synthesis_state: 'FAILED', synthesis_attempts: 4, reportPresent: false }), NOW), 'FAILED');
});

test('DELIVERED needs READY and the report itself', () => {
  assert.equal(reportDeliveryState(job({ synthesis_state: 'READY', reportPresent: true }), NOW), 'DELIVERED');
  assert.equal(reportDeliveryState(job({ synthesis_state: 'READY' }), NOW), 'DELIVERED', 'unknown presence trusts READY (a list that does not read the payload)');
  assert.notEqual(reportDeliveryState(job({ synthesis_state: 'READY', reportPresent: false }), NOW), 'DELIVERED');
  assert.equal(isReportDelivered('READY', true), true);
  assert.equal(isReportDelivered('READY', false), false);
  assert.equal(isReportDelivered('PENDING', true), false);
});

test('research done, report still being written or retried → PREPARING', () => {
  for (const s of ['NONE', 'PENDING', null]) assert.equal(reportDeliveryState(job({ synthesis_state: s }), NOW), 'PREPARING');
  assert.equal(reportDeliveryState(job({ synthesis_state: 'FAILED', synthesis_attempts: 2 }), NOW), 'PREPARING', 'the driver still retries');
});

test('a report still missing past the settle grace is FAILED — exactly when billing releases', () => {
  const late = Date.parse(COMPLETED_AT) + REPORT_SETTLE_GRACE_MS + 1;
  assert.equal(reportDeliveryState(job({ synthesis_state: 'PENDING' }), late), 'FAILED');
  assert.equal(reportDeliveryState(job({ synthesis_state: 'READY', reportPresent: false }), late), 'FAILED');
});

test('research states are not delivery states', () => {
  assert.equal(reportDeliveryState({ status: 'RUNNING' }, NOW), 'RESEARCHING');
  assert.equal(reportDeliveryState({ status: 'WAITING_HUMAN' }, NOW), 'RESEARCHING');
  assert.equal(reportDeliveryState({ status: 'FAILED' }, NOW), 'RESEARCH_FAILED');
  assert.equal(reportDeliveryState({ status: 'CANCELLED' }, NOW), 'STOPPED');
  assert.equal(reportDeliveryState({ status: 'PAUSED' }, NOW), 'STOPPED');
});

test('delivery, billing and the background job agree on every finished state', () => {
  const cases = [
    job({ synthesis_state: 'READY' }), job({ synthesis_state: 'PENDING' }), job({ synthesis_state: 'NONE', synthesis_attempts: 0 }),
    job({ synthesis_state: 'FAILED', synthesis_attempts: 2 }), job({ synthesis_state: 'FAILED', synthesis_attempts: 4 }),
  ];
  for (const now of [NOW, Date.parse(COMPLETED_AT) + REPORT_SETTLE_GRACE_MS + 1]) {
    for (const c of cases) {
      const d = reportDeliveryState(c, now);
      const bill = settlementOutcome(c, { maxSynthesisAttempts: REPORT_MAX_ATTEMPTS, synthesisGraceMs: REPORT_SETTLE_GRACE_MS, now });
      const mirror = verifyMirror({ ...c, stage: 'COMPLETE', cancelled_at: null }, now).state;
      assert.equal(d === 'DELIVERED', bill === 'COMPLETE', `charge ⇔ delivered (${JSON.stringify(c)})`);
      assert.equal(d === 'DELIVERED', mirror === 'COMPLETED', `job centre COMPLETED ⇔ delivered (${JSON.stringify(c)})`);
      assert.equal(d === 'FAILED', bill === 'SYSTEM_FAILED', `released ⇔ report failed (${JSON.stringify(c)})`);
    }
  }
});

test('billing: a READY marker without the report is never charged', () => {
  const opts = { maxSynthesisAttempts: 4, synthesisGraceMs: REPORT_SETTLE_GRACE_MS, now: NOW };
  assert.equal(settlementOutcome(job({ synthesis_state: 'READY' }), { ...opts, reportPresent: true }), 'COMPLETE');
  assert.equal(settlementOutcome(job({ synthesis_state: 'READY' }), { ...opts, reportPresent: null }), 'COMPLETE', 'unknown keeps the old rule');
  assert.equal(settlementOutcome(job({ synthesis_state: 'READY' }), { ...opts, reportPresent: false }), null, 'wait, never charge');
  assert.equal(settlementOutcome(job({ synthesis_state: 'READY' }), { ...opts, reportPresent: false, now: Date.parse(COMPLETED_AT) + REPORT_SETTLE_GRACE_MS + 1 }), 'SYSTEM_FAILED');
  assert.equal(settlementOutcome({ status: 'PAUSED' }, { ...opts, reportPresent: false }), 'STOPPED', 'non-COMPLETE outcomes untouched');
});

/* ── the numbers are the pipeline's numbers ─────────────────────────────── */

test('attempt budget and settle grace match research-agent, verify-synthesis and the SQL rule', () => {
  assert.match(RA, /const MAX_SYNTHESIS_ATTEMPTS = 4;/);
  assert.match(RA, /const SYNTHESIS_SETTLE_GRACE_MS = 2 \* 60 \* 60 \* 1000;/);
  assert.match(VS, /const REPORT_MAX_ATTEMPTS = 4;/);
  assert.equal(REPORT_MAX_ATTEMPTS, 4);
  assert.equal(REPORT_SETTLE_GRACE_MS, 2 * 60 * 60 * 1000);
  assert.match(SQL, /p_synthesis_state = 'READY' and p_has_report then 'DELIVERED'/);
  assert.match(SQL, /p_synthesis_state = 'FAILED' and coalesce\(p_attempts, 0\) >= 4 then 'FAILED'/);
  assert.match(SQL, /p_completed_at < now\(\) - interval '2 hours' then 'FAILED'/);
});

/* ── billing and notifications fire on delivery, not on research completion ── */

test('research-agent commits a Verify use only through settlementOutcome (READY), never on research completion', () => {
  const literalComplete = RA.match(/closeBilling\([^)]*'COMPLETE'\)/g) ?? [];
  assert.deepEqual(literalComplete, [], 'no closeBilling(…, COMPLETE) outside the settlement decision');
  const sweep = RA.slice(RA.indexOf('async function settleVerifyBudgets'), RA.indexOf('async function retireAbandonedJobs'));
  assert.match(sweep, /settlementOutcome\(job, \{[^}]*reportPresent \}/, 'the sweep passes whether the report exists');
  assert.match(sweep, /\.not\('synthesis_json', 'is', null\)/, 'presence is read without the payload');
});

test('the settlement sweep also closes Verify uses funded by a trial, a plan, the owner or a grant (no wallet row)', () => {
  // prod 674df06e (2026-10-30): delivered on a trial, its saas_usage stayed RESERVED because the
  // sweep read verify_billing only; the sweeper would then have expired it and handed the trial back.
  const sweep = RA.slice(RA.indexOf('async function settleVerifyBudgets'), RA.indexOf('async function retireAbandonedJobs'));
  assert.match(sweep, /from\('verify_billing'\)\.select\('job_id'\)\.eq\('state', 'ACTIVE'\)/, 'wallet budgets still swept');
  assert.match(sweep, /from\('saas_usage'\)\.select\('idempotency_key'\)\s*\.eq\('feature', 'VERIFY'\)\.eq\('state', 'RESERVED'\)\.like\('idempotency_key', 'verify:%'\)/,
    'open Verify usage reservations are swept too');
  assert.match(sweep, /String\(u\.idempotency_key\)\.slice\('verify:'\.length\)/, 'the job id is the key after verify:');
  assert.match(sweep, /new Set\(\[/, 'a job with both a wallet row and a usage row is closed once per tick');
  assert.match(sweep, /\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(id\)/, 'only well-formed job ids reach the query');
  // verify_billing_close commits a RESERVED usage on COMPLETE and releases it otherwise (20261207100100).
  const wiring = read('supabase/migrations/20261207100100_saas_entitlement_wiring.sql');
  assert.match(wiring, /v_r := public\.saas_usage_commit\(v_user, 'VERIFY', v_u\.idempotency_key\);/);
  assert.match(wiring, /v_r := public\.saas_usage_release\(v_user, 'VERIFY', v_u\.idempotency_key, p_outcome\);/);
});

test('the "Verify completed" notification is sent by verify-synthesis after the report is saved, and research-agent never sends it', () => {
  assert.equal(/VERIFY_COMPLETE/.test(RA), false, 'research-agent must not announce a completed verification');
  const persistAt = VS.indexOf('await persist(writer, jobId, payload);');
  const notifyAt = VS.indexOf("type: 'VERIFY_COMPLETE'");
  assert.ok(persistAt > 0 && notifyAt > persistAt, 'notify only after the report is persisted');
  const jobNotice = read('src/jobs/jobNotice.ts');
  assert.match(jobNotice, /if \(job\.state !== 'COMPLETED'\) return \{ kind: 'SKIP'/, 'the job-centre notice needs COMPLETED, which the mirror gives only on READY');
});

test('the saas wrapper commits trial / plan use only for COMPLETE and releases every other outcome', () => {
  const wiring = read('supabase/migrations/20261207100100_saas_entitlement_wiring.sql');
  assert.match(wiring, /if p_outcome = 'COMPLETE' then\s+v_r := public\.saas_usage_commit/);
  assert.match(wiring, /else\s+v_r := public\.saas_usage_release/);
});

/* ── why a report failed is written down ────────────────────────────────── */

test('every place that marks a report FAILED records why — after the state, never instead of it', () => {
  for (const [name, src, marker] of [
    ['driver', RA, "source: 'DRIVER'"], ['immediate', RA, "source: 'RESEARCH'"], ['background', VS, "source: 'BACKGROUND'"],
  ]) {
    const at = src.indexOf(marker);
    assert.ok(at > 0, `${name} records the failure`);
    const before = src.slice(Math.max(0, at - 700), at);
    assert.match(before, /synthesis_state: 'FAILED'/, `${name}: FAILED is written first`);
  }
  assert.match(RA, /throw await synthesisHttpError\(res\)/, 'a non-2xx answer keeps its status and body (BOOT_ERROR)');
});

test('the recorded reason is bounded and never carries a credential', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcDEF123_-xyz';
  const r = reportFailureReason(new Error(`verify-synthesis 503: {"code":"BOOT_ERROR"} Authorization: Bearer ${jwt} key sk-proj-ABCDEFGHIJKLMNOP1234`));
  assert.match(r, /verify-synthesis 503/);
  assert.match(r, /BOOT_ERROR/);
  assert.equal(r.includes(jwt), false);
  assert.equal(r.includes('sk-proj-ABCDEFGHIJKLMNOP1234'), false);
  assert.ok(reportFailureReason('x'.repeat(5000)).length <= 400);
  assert.equal(reportFailureReason(''), 'unknown');
  assert.equal(looksLikeBootError(503, '{"code":"BOOT_ERROR","message":"Worker failed to boot (please check logs)"}'), true);
  assert.equal(looksLikeBootError(500, 'internal_error'), false);
  assert.equal(looksLikeBootError(401, 'BOOT_ERROR'), false);
});

test('verify_report_failures is admin-only: RLS on, no policy, nothing granted to customers', () => {
  assert.match(SQL, /alter table public\.verify_report_failures enable row level security;/);
  assert.equal(/create policy[\s\S]*verify_report_failures/i.test(SQL), false);
  assert.match(SQL, /revoke all on table public\.verify_report_failures from public, anon, authenticated;/);
  assert.match(SQL, /admin_verify_delivery[\s\S]*if not public\.is_admin\(\) then raise exception 'FORBIDDEN'/);
});

/* ── the customer never sees research completion as a report ───────────── */

test('the page: no evidence shell in place of the report; preparing or failed instead', () => {
  const page = read('src/pages/VerifyPage.tsx');
  assert.match(page, /\}\/>:<VerifyReportDelivery state=\{reportDelivery\}/, 'the else branch of the report is the delivery card');
  assert.equal(page.includes('<OverallAssessmentCard'), false, 'the evidence-only fallback is gone');
  assert.match(page, /awaitingSignIn,reportDelivery\}\)/, 'the completion predicate hears the delivery state');
  assert.match(page, /setReportDelivery\(await readReportDeliveryView\(id\)\)/);
  const st = { jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, synthesis: null, synthesisLoading: false, synthesisSettled: true };
  assert.equal(verifyCustomerState({ ...st, reportDelivery: 'FAILED' }), 'FAILED');
  assert.equal(verifyCustomerState({ ...st, reportDelivery: 'PREPARING' }), 'FINALIZING');
});

test('the history list says which reports are being prepared or failed', () => {
  assert.match(read('src/services/researchJobs.ts'), /synthesis_state,synthesis_attempts/);
  const list = read('src/components/verify/VerifyCheckList.tsx');
  assert.match(list, /reportDeliveryState\(j\)/);
  assert.match(list, /vh_state_report_preparing/);
  assert.match(list, /vh_state_report_failed/);
});

test('Admin: the retry calls the audited RPC and survives its absence', () => {
  const card = read('src/components/admin/VerifyDeliveryCard.tsx');
  assert.match(card, /rpc\('admin_verify_retry_synthesis', \{ p_job_id: target\.id, p_reason: reason\.trim\(\) \}\)/);
  assert.match(card, /isMissingFunction\(error\)/);
  assert.match(SQL, /'retryAvailable', to_regprocedure\('public\.admin_verify_retry_synthesis\(uuid, text\)'\) is not null/);
  assert.match(read('src/pages/admin/AdminProvidersPage.tsx'), /<VerifyDeliveryCard \/>/);
});
