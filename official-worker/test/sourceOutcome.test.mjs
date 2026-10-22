// Task-state honesty (Verify V1 audit F2/F3): a durable task is SUCCEEDED
// only when usable, validated evidence was obtained, and carries its precise
// outcome. Fixtures are the SHAPES of production job 61c1c38c (2026-10-22),
// with every personal value replaced. No network, no paid solve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceOutcome, usableDocumentCount, SUCCESS_OUTCOMES } from '../.tstest-build/queue/sourceOutcome.js';
import { createVerifyExecutor, priorSolves } from '../.tstest-build/queue/executor.js';
import { CaptchaService, captchaService, parseCaptchaPolicy } from '../.tstest-build/captcha/captchaService.js';
import { rsPageReadDecides, rsDomOnlyNoResult, classifyRsGridResponse } from '../.tstest-build/workflows/financial/RsTaxpayerResponse.js';

let seq = 0;
const mkTask = (o = {}) => ({
  id: `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`, jobId: '11111111-1111-4111-8111-111111111111',
  source: 'mygov', lane: 'HTTP', dedupeKey: 'mygov', scopeKey: 'mygov:01.14.07.001.044', input: { cadastral: '01.14.07.001.044' },
  state: 'RUNNING', attempts: 1, maxAttempts: 3, fencingToken: 1, leaseSeconds: 600, error: null, ...o,
});
const gw = () => {
  const calls = { upload: [], captcha: [] };
  return { calls, async upload(sha, ct, body) { calls.upload.push({ sha, ct, chars: body.length }); return `sha256/${sha.slice(0, 2)}/${sha}`; }, async captcha(e) { calls.captcha.push(...e); return {}; } };
};
const ctx = (g) => ({ signal: new AbortController().signal, gateway: g, workerId: 'test' });
const noBrowser = { launchBrowser: async () => { throw new Error('no browser'); }, closeBrowser: async () => {} };

const extract = (n) => ({
  id: `doc_${n}`, url: `https://bs.napr.gov.ge/GetBlob?pid=101&bid=REDACTED${n}`, title: 'ამონაწერი საჯარო რეესტრიდან', source: 'mygov',
  documentType: 'PDF_DOCUMENT', sha256: 'a'.repeat(64), complete: true, pageCount: 3, pagesRead: 3,
  rawText: 'მიწის (უძრავი ქონების) საკადასტრო კოდი N 01.14.07.001.044 ამონაწერი საჯარო რეესტრიდან [owners redacted]',
});
const accepted = { challengeDetected: true, type: 'RECAPTCHA_V2', attempts: 1, outcome: 'ACCEPTED', latencyMs: 5000 };
const exhausted = { challengeDetected: true, type: null, attempts: 0, outcome: 'BUDGET_EXHAUSTED', latencyMs: 0 };

/** Production mygov result, job 61c1c38c: 12 accepted solves, then the budget ran out; 65 of 164 documents read. */
function mygovBudgetExhausted({ docs = 3 } = {}) {
  return {
    source: 'mygov', adapter: 'service176-public-api', status: 'BLOCKED', blocked: true, captcha: true, authRequired: false,
    searched: true, submitted: true, submissionConfirmed: true, resultConfirmed: false, resultValidated: false, noResultConfirmed: false,
    error: 'CAPTCHA_REQUIRED: automatic verification BUDGET_EXHAUSTED',
    documents: Array.from({ length: docs }, (_, i) => extract(i)),
    documentsDiscovered: 164, documentsExtracted: docs,
    captchaResolution: [...Array(12).fill(accepted), exhausted, exhausted],
    workflowResult: { source: 'mygov', state: 'CAPTCHA_REQUIRED', completed: false },
  };
}

test('outcome: the production MyGov shape (BLOCKED, budget exhausted, documents read) is PARTIAL, not a clean success', () => {
  const v = classifySourceOutcome(mygovBudgetExhausted());
  assert.deepEqual(v, { outcome: 'PARTIAL', reason: 'CAPTCHA_BUDGET_EXHAUSTED' });
  assert.ok(SUCCESS_OUTCOMES.has('PARTIAL'));
  // Nothing readable: the gate stopped it outright.
  assert.deepEqual(classifySourceOutcome(mygovBudgetExhausted({ docs: 0 })), { outcome: 'CAPTCHA_BLOCKED', reason: 'CAPTCHA_BUDGET_EXHAUSTED' });
});

test('outcome: the taxonomy over the existing status vocabulary', () => {
  const c = (r, keep) => classifySourceOutcome(r, keep).outcome;
  assert.equal(c({ status: 'SEARCH_CONFIRMED', documents: [extract(1)] }), 'RETRIEVED');
  assert.equal(c({ status: 'NO_RESULT_CONFIRMED', noResultConfirmed: true }), 'NO_RECORD_CONFIRMED');
  assert.equal(c({ status: 'WAITING_HUMAN', captchaResolution: [{ outcome: 'NO_CHANGE' }] }), 'CAPTCHA_BLOCKED');
  assert.equal(c({ status: 'SEARCH_CONFIRMED' }, true), 'CAPTCHA_BLOCKED', 'a human pause is never a success');
  assert.equal(c({ status: 'AUTH_REQUIRED' }), 'AUTH_REQUIRED');
  assert.equal(c({ status: 'FAILED', error: 'boom' }), 'PROVIDER_UNAVAILABLE');
  assert.equal(c({ status: 'TIMEOUT', documents: [] }), 'PROVIDER_UNAVAILABLE');
  assert.equal(c({ status: 'TIMEOUT', documents: [extract(1)] }), 'PARTIAL');
  assert.equal(c({ status: 'SUBMITTED_UNCONFIRMED', documents: [{ ...extract(1), complete: false, error: 'TEXT_EXTRACTION_UNAVAILABLE' }] }), 'UNPARSEABLE');
  assert.equal(c({ status: 'SUBMITTED_UNPARSED' }), 'UNPARSEABLE');
  assert.equal(c({ status: 'VERIFICATION_FAILED', rsVerification: { serverOutcome: 'REJECTED' } }), 'CAPTCHA_BLOCKED');
  assert.equal(c({ status: 'SEARCH_CONFIRMED', tasApi: { ledger: { incomplete: true, incompleteReasons: ['budget'] } }, documents: [extract(1)] }), 'PARTIAL');
  assert.equal(usableDocumentCount({ documents: [extract(1), { rawText: '' }, { complete: false, rawText: 'x'.repeat(50) }, { rawText: 'readable enough official text' }] }), 2);
});

test('executor (mygov): budget-exhausted run completes as PARTIAL — documents kept, status still BLOCKED, outcome stamped', async () => {
  const g = gw();
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: {}, mygov: async () => ({ result: mygovBudgetExhausted(), keep: false }) });
  const out = await exec(mkTask(), ctx(g));
  assert.equal(out.type, 'complete');
  assert.equal(out.result.sourceOutcome, 'PARTIAL');
  assert.equal(out.result.outcomeReason, 'CAPTCHA_BUDGET_EXHAUSTED');
  assert.equal(out.result.status, 'BLOCKED', 'the report keeps disclosing the source as not fully verified');
  assert.equal(out.result.documents.length, 3, 'what was read is preserved');
});

test('executor (mygov): blocked with nothing read FAILS; a spent budget is never retried', async () => {
  const g = gw();
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: {}, mygov: async () => ({ result: mygovBudgetExhausted({ docs: 0 }), keep: false }) });
  const t = mkTask({ input: { cadastral: '01.14.07.001.044', captchaPolicy: { enabled: true, maxSolvesPerJob: 12 } } });
  // The task already spent its whole budget on this replica.
  captchaService.carrySolves(t.id, 12);
  const out = await exec(t, ctx(g));
  assert.equal(out.type, 'fail');
  assert.equal(out.retryable, false, 'a retry could only spend beyond the budget');
  assert.equal(out.error, 'HUMAN_VERIFICATION_REQUIRED:BUDGET_EXHAUSTED sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_BUDGET_EXHAUSTED solves=12');
  assert.equal(captchaService.solvesFor(t.id), 0, 'per-task counters are dropped when the attempt ends');
});

test('executor (mygov): unreadable / deadline outcomes fail with one bounded retry', async () => {
  const g = gw();
  const outs = [
    { result: { source: 'mygov', status: 'SUBMITTED_UNCONFIRMED', documents: [], error: 'No readable official document acquired' }, keep: false },
    { result: { source: 'mygov', status: 'SUBMITTED_UNCONFIRMED', documents: [] }, keep: false },
    { result: { source: 'mygov', status: 'TIMEOUT', documents: [], error: 'Service 176 provider deadline exceeded' }, keep: false },
    { result: { source: 'mygov', status: 'TIMEOUT', documents: [] }, keep: false },
  ];
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: {}, mygov: async () => outs.shift() });
  assert.deepEqual(await exec(mkTask({ attempts: 1 }), ctx(g)), { type: 'fail', error: 'SOURCE_UNPARSEABLE sourceOutcome=UNPARSEABLE reason=UNCONFIRMED', retryable: true, retryAfterSeconds: 20 });
  assert.equal((await exec(mkTask({ attempts: 2 }), ctx(g))).retryable, false);
  assert.deepEqual(await exec(mkTask({ attempts: 1 }), ctx(g)), { type: 'fail', error: 'Service 176 provider deadline exceeded sourceOutcome=PROVIDER_UNAVAILABLE reason=TIMEOUT', retryable: true });
  assert.equal((await exec(mkTask({ attempts: 2 }), ctx(g))).retryable, false);
});

test('executor: a retry continues the task\'s solve budget (solves=N from the previous attempt)', async () => {
  assert.equal(priorSolves({ attempts: 1, error: 'x solves=4' }), 0, 'a first attempt carries nothing');
  assert.equal(priorSolves({ attempts: 2, error: 'CAPTCHA_NO_CHANGE sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_NO_CHANGE solves=3' }), 3);
  assert.equal(priorSolves({ attempts: 2, error: 'LEASE_EXPIRED' }), 0);
  const g = gw();
  let seen = null;
  const t = mkTask({ attempts: 2, error: 'CAPTCHA_NO_CHANGE sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_NO_CHANGE solves=3' });
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: {}, mygov: async () => { seen = captchaService.solvesFor(t.id); return { result: { status: 'WAITING_HUMAN', captchaResolution: [{ outcome: 'NO_CHANGE' }] }, keep: false }; } });
  const out = await exec(t, ctx(g));
  assert.equal(seen, 3, 'the worker starts this attempt with the earlier spend counted');
  assert.match(out.error, / solves=3$/);
  assert.equal(out.retryable, false);
});

test('captcha: carried solves bound maxSolvesPerJob; no carry leaves every other caller\'s behaviour unchanged', () => {
  const svc = new CaptchaService({ env: { TWOCAPTCHA_API_KEY: 'k'.repeat(32) } });
  const policy = parseCaptchaPolicy({ enabled: true, maxSolvesPerJob: 2, maxAttemptsPerProvider: 2 });
  assert.equal(svc.gate(policy, 'rstax', 'job-a'), null, 'nothing carried: the gate is exactly as before');
  svc.carrySolves('job-a', 2);
  assert.equal(svc.gate(policy, 'rstax', 'job-a'), 'BUDGET_EXHAUSTED');
  svc.carrySolves('job-a', 1);
  assert.equal(svc.solvesFor('job-a'), 2, 'a carry never lowers the count');
  svc.carrySolves('job-b', Number.NaN);
  assert.equal(svc.solvesFor('job-b'), 0);
  assert.equal(svc.gate(policy, 'mygov', 'job-b'), null, 'budgets stay per job/task id');
});

// ── RS.ge ──
const RS_URL = 'https://www.rs.ge/TaxpayersRegistry';
const rsRec = (o) => ({ status: 'VERIFICATION_FAILED', serverOutcome: 'UNPARSEABLE', httpStatus: 200, responseFormat: 'JSON', rowCount: 0, columns: [], rawResponse: '{"redacted":true}', rawResponseBytes: 702, rawTruncated: false, requestHadTin: true, reason: 'NO_ROW_ARRAY', checkedAt: '2026-10-22T12:04:12.000Z', sourceUrl: RS_URL, ...o });
const rsTask = (o = {}) => mkTask({ source: 'rstax', lane: 'BROWSER', dedupeKey: 'rstax:405000000', scopeKey: 'rstax:405000000', input: { idCode: '405000000', name: 'შპს ტესტი', captchaPolicy: { enabled: true, maxSolvesPerJob: 12 } }, ...o });
const rsExec = (outs) => createVerifyExecutor({ launchBrowser: async (id) => ({ id }), closeBrowser: async () => {}, orchestrator: { executeSource: async () => outs.shift() } });

test('executor (rstax): the production UNPARSEABLE answer after an accepted token → UNPARSEABLE, ONE bounded retry', async () => {
  // Task a3393bb1: token delivered, search submitted, RS.ge answered 200 without a grid; ledger NO_CHANGE.
  const failed = () => ({ result: { source: 'rstax', status: 'VERIFICATION_FAILED', error: 'RS.ge answered but the answer could not be read (NO_ROW_ARRAY)', rsVerification: rsRec(), captchaResolution: [{ challengeDetected: true, type: 'RECAPTCHA_V2', attempts: 1, outcome: 'NO_CHANGE', latencyMs: 40000 }] }, keep: false });
  const g = gw();
  const exec = rsExec([failed(), failed(), failed()]);
  const first = await exec(rsTask({ attempts: 1 }), ctx(g));
  assert.equal(first.type, 'fail');
  assert.equal(first.retryable, true);
  assert.equal(first.retryAfterSeconds, 20);
  assert.match(first.error, /^RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=UNPARSEABLE http=200 evidence=[0-9a-f]{64} sourceOutcome=UNPARSEABLE reason=NO_ROW_ARRAY$/);
  const second = await exec(rsTask({ attempts: 2, error: first.error }), ctx(g));
  assert.equal(second.retryable, false, 'never more than one retry');
  // A task whose budget is already spent is not retried at all.
  const spent = rsTask({ attempts: 1 });
  captchaService.carrySolves(spent.id, 12);
  const third = await exec(spent, ctx(g));
  assert.equal(third.retryable, false);
  assert.match(third.error, / solves=12$/);
  assert.equal(g.calls.upload.filter((u) => u.ct === 'application/json').length, 3, 'every answer stored as evidence');
});

test('executor (rstax): a "Not found" read off the page over an unreadable answer is NOT a confirmed no-record', async () => {
  // Task cabca14f (company 405456359, a registered LLC): stored as VERIFIED / NO_RESULT, reason PAGE_READ_UNPARSEABLE.
  const domOnly = { source: 'rstax', status: 'NO_RESULT_CONFIRMED', noResultConfirmed: true, taxpayerData: null, rsVerification: rsRec({ status: 'VERIFIED', serverOutcome: 'NO_RESULT', reason: 'PAGE_READ_UNPARSEABLE' }), captchaResolution: [{ challengeDetected: true, type: 'RECAPTCHA_V2', attempts: 1, outcome: 'ACCEPTED', latencyMs: 40440 }] };
  const realEmpty = { source: 'rstax', status: 'NO_RESULT_CONFIRMED', noResultConfirmed: true, rsVerification: rsRec({ status: 'VERIFIED', serverOutcome: 'NO_RESULT', reason: null, columns: [] }) };
  const g = gw();
  const exec = rsExec([{ result: domOnly, keep: false }, { result: realEmpty, keep: false }]);
  const out = await exec(rsTask({ attempts: 1 }), ctx(g));
  assert.equal(out.type, 'fail', 'never SUCCEEDED, never cached for other jobs');
  assert.match(out.error, /rs=VERIFICATION_FAILED outcome=UNPARSEABLE .* sourceOutcome=UNPARSEABLE reason=PAGE_READ_UNPARSEABLE$/);
  assert.equal(out.retryable, true);
  const ok = await exec(rsTask(), ctx(g));
  assert.equal(ok.type, 'complete');
  assert.equal(ok.result.sourceOutcome, 'NO_RECORD_CONFIRMED', 'RS.ge\'s own empty grid is a validated no-record');
});

test('RS.ge: the page decides only where RS.ge\'s own answer does not contradict it', () => {
  const unparseable = classifyRsGridResponse({ status: 200, contentType: 'application/json', body: '{"foo":1}' });
  const empty = classifyRsGridResponse({ status: 200, contentType: 'application/json', body: '{"Data":[],"Total":0,"Errors":null}' });
  const rejected = classifyRsGridResponse({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'გთხოვთ მონიშნოთ უსაფრთხოების ღილაკი' }) });
  assert.equal(unparseable.outcome, 'UNPARSEABLE');
  assert.equal(rsPageReadDecides(null, 'NO_RESULT_CONFIRMED'), true, 'no answer captured: the page is all there is');
  assert.equal(rsPageReadDecides(empty, 'NO_RESULT_CONFIRMED'), true);
  assert.equal(rsPageReadDecides(unparseable, 'NO_RESULT_CONFIRMED'), false, 'an empty grid over an unreadable answer is not an absence');
  assert.equal(rsPageReadDecides(unparseable, 'SEARCH_CONFIRMED'), true, 'parsed taxpayer fields on the page are evidence');
  assert.equal(rsPageReadDecides(rejected, 'SEARCH_CONFIRMED'), false);
  assert.equal(rsDomOnlyNoResult({ status: 'VERIFIED', serverOutcome: 'NO_RESULT', reason: 'PAGE_READ_UNPARSEABLE' }), true);
  assert.equal(rsDomOnlyNoResult({ status: 'VERIFIED', serverOutcome: 'NO_RESULT', reason: 'PAGE_READ_HTTP_ERROR' }), true);
  assert.equal(rsDomOnlyNoResult({ status: 'VERIFIED', serverOutcome: 'NO_RESULT', reason: 'PAGE_READ' }), false, 'no answer was captured');
  assert.equal(rsDomOnlyNoResult({ status: 'VERIFIED', serverOutcome: 'NO_RESULT', reason: null }), false);
  assert.equal(rsDomOnlyNoResult({ status: 'VERIFIED', serverOutcome: 'ACCEPTED', reason: 'PAGE_READ_UNPARSEABLE' }), false);
});

test('RS.ge: an unreadable JSON answer carries its structure — names and types, never a value — into the log and the record', async () => {
  const { buildRsVerificationRecord, rsRecordLogFields } = await import('../.tstest-build/workflows/financial/RsTaxpayerResponse.js');
  const body = JSON.stringify({ Data: { TaxPayerID: '405000000', Name: 'შპს ტესტი' }, Total: 1, Map: { '405000000': true } });
  const cls = classifyRsGridResponse({ status: 200, contentType: 'application/json', body });
  assert.equal(cls.outcome, 'UNPARSEABLE');
  assert.equal(cls.shape, '{Data:{TaxPayerID:string(9),Name:string(9)},Total:number,Map:{#:boolean}}');
  const rec = buildRsVerificationRecord({ capture: { status: 200, contentType: 'application/json', body }, classification: cls, tin: '405000000', sourceUrl: RS_URL });
  const log = JSON.stringify(rsRecordLogFields(rec));
  assert.match(log, /"shape":"\{Data:/);
  assert.ok(!log.includes('405000000') && !log.includes('ტესტი'), 'no value reaches the log');
  // A readable answer carries no shape.
  assert.equal(classifyRsGridResponse({ status: 200, contentType: 'application/json', body: '{"Data":[],"Total":0}' }).shape, undefined);
});
