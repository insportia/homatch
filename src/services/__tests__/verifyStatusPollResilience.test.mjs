// Pure-logic regression test for src/pages/VerifyPage.tsx's status-poll
// resilience fix (v33, P0 incident 2026-09-07, production job
// 533a8c19-f160-4f06-ab27-517c1f661b86). Production DB inspection during the
// incident proved the backend research job was genuinely still alive
// (status RUNNING, stage BROWSER_WAITING, 37%, 1/3 sources, error=null) at
// the exact moment the customer-facing UI showed "Internal server error" —
// a single transient status-poll failure (a 500 from research-agent's own
// then-unhandled promise rejection in advance()/pollBrowser() — see the
// matching v32 fix in supabase/functions/research-agent/index.ts and its
// test mirror research_agent_pure_logic.node-test.mjs — or a plain network
// hiccup) was being treated by check() as a terminal failure: stop polling,
// blank the loading UI, show the red error box, all while the backend kept
// working normally.
//
// VerifyPage.tsx is a .tsx file this sandbox cannot compile/import directly
// (see companyProfileReconciliationFallback.test.mjs in this same directory
// for why pure logic is copied verbatim elsewhere in this repo). Every
// function below is copied verbatim from VerifyPage.tsx (or, for
// simulateCheck/simulateResume, mirrors its control flow line-for-line) —
// keep both in sync whenever either changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- copied verbatim from VerifyPage.tsx ----

async function readFunctionErrorBody(e) {
  try {
    const ctx = e?.context;
    if (ctx && typeof ctx.json === 'function') {
      return await (typeof ctx.clone === 'function' ? ctx.clone() : ctx).json();
    }
  } catch {
    /* not JSON / already consumed / no body at all — treated as no body */
  }
  return null;
}

async function resolveFunctionErrorMessage(e, fallback) {
  const body = await readFunctionErrorBody(e);
  if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  return e?.message && e.message !== 'Edge Function returned a non-2xx status code' ? e.message : fallback;
}

const MAX_TRANSIENT_POLL_RETRIES = 8;
function computeTransientPollBackoffMs(retryCount) {
  const n = Math.max(0, Math.floor(Number(retryCount) || 0));
  return Math.min(2200 * Math.pow(1.6, n), 15000);
}

async function classifyFunctionInvokeError(e, fallback) {
  const body = await readFunctionErrorBody(e);
  const message = body && typeof body.error === 'string' && body.error.trim() ? body.error : e?.message && e.message !== 'Edge Function returned a non-2xx status code' ? e.message : fallback;
  const statusCode = Number(e?.context?.status) || 0;
  const category = statusCode === 401 ? 'AUTH' : statusCode === 503 ? 'CONFIG' : statusCode === 400 || statusCode === 404 || statusCode === 409 ? 'TERMINAL' : 'TRANSIENT';
  return { message, category };
}

// The exact `if(!id||busy.current)return` guard at the top of check() — the
// single thing standing between a slow poll response and a second,
// overlapping poll for the same job (regression requirement #10: no
// unhandled promise/retry race creates parallel polling loops).
function shouldSkipConcurrentCheck(id, busy) {
  return !id || !!busy;
}

// ---- test-only simulation harness ----
// Mirrors check()'s control flow line-for-line (see VerifyPage.tsx) against
// a mocked `{data,error}` invoke() result, without any of React/supabase-js/
// setTimeout. `state` is mutated in place and returned so a test can chain
// several simulated polls the way real consecutive check() calls would.

function makeInitialState(jobId) {
  return { jobId, loading: true, err: null, pollNotice: null, report: null, captcha: null, progress: null, transientRetryCount: 0, terminal: false, scheduledBackoffMs: [] };
}

async function simulateCheck(state, invokeResult) {
  try {
    const { data, error } = invokeResult;
    if (error) throw error;
    if (data?.error) {
      // A 2xx response body carrying `error` only happens for a job the
      // backend has already marked terminally FAILED (see the v32
      // sanitizeForCustomer() fix) — always terminal.
      state.terminal = true;
      state.loading = false;
      state.pollNotice = null;
      state.transientRetryCount = 0;
      state.err = data.error;
      return state;
    }
    state.pollNotice = null;
    state.transientRetryCount = 0;
    if (data?.progress) state.progress = data.progress;
    if (data?.status === 'FAILED') {
      state.terminal = true;
      state.loading = false;
      state.err = data.error || 'verify_err_research_failed';
      return state;
    }
    if (data?.status === 'WAITING_HUMAN') {
      state.terminal = true;
      state.loading = false;
      state.captcha = data.result_json || {};
      return state;
    }
    if (data?.status === 'COMPLETE' && data.result_json) {
      state.terminal = true;
      state.loading = false;
      state.captcha = null;
      state.report = data.result_json;
      return state;
    }
    return state;
  } catch (e) {
    const { message, category } = await classifyFunctionInvokeError(e, 'verify_err_status_fetch_failed');
    if (category === 'TRANSIENT' && state.transientRetryCount < MAX_TRANSIENT_POLL_RETRIES) {
      state.transientRetryCount += 1;
      state.pollNotice = 'verify_status_poll_retrying';
      state.scheduledBackoffMs.push(computeTransientPollBackoffMs(state.transientRetryCount));
      return state;
    }
    state.terminal = true;
    state.loading = false;
    state.pollNotice = null;
    state.err = message;
    return state;
  }
}

// Mirrors resume()'s reset-then-invoke-then-schedule shape (no transient
// retry logic there — a human-initiated action gets an immediate terminal
// error on failure, same as before this fix; see the "Current Work"
// rationale in this file's own header comment for why that scope was kept
// narrow).
async function simulateResume(state, invokeResult) {
  state.err = null;
  state.pollNotice = null;
  state.transientRetryCount = 0;
  state.captcha = null;
  state.loading = true;
  try {
    const { data, error } = invokeResult;
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    state.polling = true; // stands in for schedule(id,500)
    return state;
  } catch (e) {
    state.loading = false;
    state.err = await resolveFunctionErrorMessage(e, 'verify_err_resume_failed');
    return state;
  }
}

function makeHttpError(status, body) {
  return {
    message: 'Edge Function returned a non-2xx status code',
    context: {
      status,
      async json() {
        return body;
      },
      clone() {
        return this;
      },
    },
  };
}
function makeNetworkError(message = 'Failed to fetch') {
  // A FunctionsFetchError from supabase-js: no HTTP response was ever
  // reached, so there is no `.context` at all.
  return { message };
}

// ---- classifyFunctionInvokeError ----

test('classifyFunctionInvokeError: 401 (session expired) classifies as AUTH', async () => {
  const { category, message } = await classifyFunctionInvokeError(makeHttpError(401, { error: 'Invalid session' }), 'fallback');
  assert.equal(category, 'AUTH');
  assert.equal(message, 'Invalid session');
});

test('classifyFunctionInvokeError: 503 (GENERIC_CONFIG_ERROR_I18N) classifies as CONFIG', async () => {
  const { category, message } = await classifyFunctionInvokeError(makeHttpError(503, { error: 'This feature is temporarily unavailable.' }), 'fallback');
  assert.equal(category, 'CONFIG');
  assert.equal(message, 'This feature is temporarily unavailable.');
});

test('classifyFunctionInvokeError: 400/404/409 classify as TERMINAL', async () => {
  assert.equal((await classifyFunctionInvokeError(makeHttpError(400, { error: 'Invalid cadastral code' }), 'fallback')).category, 'TERMINAL');
  assert.equal((await classifyFunctionInvokeError(makeHttpError(404, { error: 'Job not found' }), 'fallback')).category, 'TERMINAL');
  assert.equal((await classifyFunctionInvokeError(makeHttpError(409, { error: 'CAPTCHA not completed' }), 'fallback')).category, 'TERMINAL');
});

test('classifyFunctionInvokeError: a 500 from research-agent\'s own uncaught-exception path classifies as TRANSIENT (the exact incident class)', async () => {
  const { category } = await classifyFunctionInvokeError(makeHttpError(500, { error: 'Internal server error' }), 'fallback');
  assert.equal(category, 'TRANSIENT');
});

test('classifyFunctionInvokeError: 502/504 also classify as TRANSIENT', async () => {
  assert.equal((await classifyFunctionInvokeError(makeHttpError(502, {}), 'fallback')).category, 'TRANSIENT');
  assert.equal((await classifyFunctionInvokeError(makeHttpError(504, {}), 'fallback')).category, 'TRANSIENT');
});

test('classifyFunctionInvokeError: a network-level failure with no HTTP response at all classifies as TRANSIENT, surfacing the SDK\'s own network-error message', async () => {
  const { category, message } = await classifyFunctionInvokeError(makeNetworkError('Failed to fetch'), 'verify_err_status_fetch_failed');
  assert.equal(category, 'TRANSIENT');
  assert.equal(message, 'Failed to fetch');
});

test('classifyFunctionInvokeError: with no message and no body at all, falls back to the caller-supplied fallback', async () => {
  const { category, message } = await classifyFunctionInvokeError({}, 'verify_err_status_fetch_failed');
  assert.equal(category, 'TRANSIENT');
  assert.equal(message, 'verify_err_status_fetch_failed');
});

test('classifyFunctionInvokeError: never crashes and always falls back when the body is not valid JSON', async () => {
  const e = { message: 'Edge Function returned a non-2xx status code', context: { status: 500, json: async () => { throw new Error('not json'); } } };
  const { category, message } = await classifyFunctionInvokeError(e, 'fallback');
  assert.equal(category, 'TRANSIENT');
  assert.equal(message, 'fallback');
});

// ---- computeTransientPollBackoffMs ----

test('computeTransientPollBackoffMs: starts near the existing fixed poll interval and strictly increases', () => {
  const first = computeTransientPollBackoffMs(1);
  const second = computeTransientPollBackoffMs(2);
  const third = computeTransientPollBackoffMs(3);
  assert.ok(first >= 2200, 'must never poll faster than the normal 2200ms interval');
  assert.ok(second > first);
  assert.ok(third > second);
});

test('computeTransientPollBackoffMs: bounded so a real outage still gets polled at least every 15s, never an unbounded wait', () => {
  for (const n of [4, 8, 20, 1000]) {
    assert.ok(computeTransientPollBackoffMs(n) <= 15000);
  }
});

// ---- scenario 1: start succeeds -> status succeeds ----

test('scenario 1: a healthy status poll on a RUNNING job leaves the job open with no error and no notice', async () => {
  const state = makeInitialState('job-1');
  await simulateCheck(state, { data: { status: 'CREATED', stage: 'BROWSER_WAITING', progress: { phase: 'official_browser', percent: 37 } }, error: null });
  assert.equal(state.terminal, false);
  assert.equal(state.err, null);
  assert.equal(state.pollNotice, null);
  assert.equal(state.jobId, 'job-1');
});

// ---- scenario 2: status poll gets one 500 -> next poll succeeds -> same job continues ----

test('scenario 2: a single 500 on status poll shows a calm notice and keeps the job open; the next successful poll clears it and the job continues unchanged', async () => {
  const state = makeInitialState('job-2');
  await simulateCheck(state, { data: { status: 'CREATED', progress: { phase: 'official_browser', percent: 34 } }, error: null });
  await simulateCheck(state, { data: null, error: makeHttpError(500, { error: 'Internal server error' }) });
  assert.equal(state.terminal, false, 'a single transient 500 must never terminate the job');
  assert.equal(state.err, null, 'must never populate the red error box for a transient failure');
  assert.equal(state.pollNotice, 'verify_status_poll_retrying');
  assert.equal(state.transientRetryCount, 1);
  assert.equal(state.jobId, 'job-2', 'must reconnect to the SAME job, never create a new one');
  await simulateCheck(state, { data: { status: 'CREATED', progress: { phase: 'official_browser', percent: 37 } }, error: null });
  assert.equal(state.pollNotice, null, 'the notice must clear the moment recovery succeeds');
  assert.equal(state.transientRetryCount, 0);
  assert.equal(state.err, null);
  assert.equal(state.progress.percent, 37);
});

// ---- scenario 3: network failure -> recovery without creating another job ----

test('scenario 3: a bare network failure (no HTTP response at all) is retried transiently, never treated as terminal, and never changes jobId', async () => {
  const state = makeInitialState('job-3');
  await simulateCheck(state, { data: null, error: makeNetworkError('Failed to fetch') });
  assert.equal(state.terminal, false);
  assert.equal(state.err, null);
  assert.equal(state.pollNotice, 'verify_status_poll_retrying');
  assert.equal(state.jobId, 'job-3');
  await simulateCheck(state, { data: { status: 'CREATED', progress: { percent: 40 } }, error: null });
  assert.equal(state.pollNotice, null);
  assert.equal(state.jobId, 'job-3', 'recovery must reconnect to the same job, not start a duplicate Verify');
});

// ---- scenario 4: real backend FAILED -> proper terminal UI ----

test('scenario 4: a genuinely FAILED job (2xx response, error present per the v32 sanitizeForCustomer contract) is shown as a real terminal failure', async () => {
  const state = makeInitialState('job-4');
  await simulateCheck(state, { data: { status: 'FAILED', error: 'browser failed: navigation timeout' }, error: null });
  assert.equal(state.terminal, true);
  assert.equal(state.loading, false);
  assert.equal(state.err, 'browser failed: navigation timeout');
});

test('scenario 4b: a 500 that has exhausted its transient retry budget also becomes a real terminal failure rather than retrying forever', async () => {
  const state = makeInitialState('job-4b');
  for (let i = 0; i < MAX_TRANSIENT_POLL_RETRIES; i++) {
    await simulateCheck(state, { data: null, error: makeHttpError(500, { error: 'Internal server error' }) });
    assert.equal(state.terminal, false, `retry ${i + 1} of ${MAX_TRANSIENT_POLL_RETRIES} must not yet be terminal`);
  }
  await simulateCheck(state, { data: null, error: makeHttpError(500, { error: 'Internal server error' }) });
  assert.equal(state.terminal, true, 'a failure that outlives every bounded retry must eventually surface as a real error, never hang forever');
  assert.equal(state.err, 'Internal server error');
});

// ---- scenario 5: CAPTCHA_REQUIRED -> CAPTCHA UI, not generic error ----

test('scenario 5: WAITING_HUMAN status opens the CAPTCHA UI, never the generic error box', async () => {
  const state = makeInitialState('job-5');
  await simulateCheck(state, { data: { status: 'WAITING_HUMAN', result_json: { workerJobId: 'w-1' } }, error: null });
  assert.equal(state.terminal, true, 'polling itself stops while waiting on the human, same as before this fix');
  assert.equal(state.err, null, 'CAPTCHA is not an error');
  assert.deepEqual(state.captcha, { workerJobId: 'w-1' });
});

// ---- scenario 6: resume succeeds and polling continues ----

test('scenario 6: resume() clears any stale error/notice and resumes polling on success', async () => {
  const state = makeInitialState('job-6');
  state.err = 'stale previous error';
  state.pollNotice = 'verify_status_poll_retrying';
  state.transientRetryCount = 3;
  await simulateResume(state, { data: { ok: true }, error: null });
  assert.equal(state.err, null);
  assert.equal(state.pollNotice, null);
  assert.equal(state.transientRetryCount, 0);
  assert.equal(state.polling, true);
});

test('scenario 6b: resume() failure is still a real terminal error (a human-initiated action does not silently retry)', async () => {
  const state = makeInitialState('job-6b');
  await simulateResume(state, { data: null, error: makeHttpError(409, { error: 'CAPTCHA not completed' }) });
  assert.equal(state.err, 'CAPTCHA not completed');
  assert.equal(state.loading, false);
});

// ---- scenario 7: per-source skip after unrecoverable CAPTCHA/source failure ----
// Out of scope for this file: this is the backend's own transientBrowserSession/
// legacyRetryable bounded-retry classification inside research-agent's
// advance() (supabase/functions/research-agent/index.ts), not a frontend
// concern — see classifyAdvanceError()'s own tests in
// supabase/functions/tests/research_agent_pure_logic.node-test.mjs.

// ---- scenario 8: progress updates incrementally ----

test('scenario 8: consecutive healthy polls update progress incrementally and never spuriously flag a transient notice', async () => {
  const state = makeInitialState('job-8');
  for (const percent of [34, 37, 41, 55]) {
    await simulateCheck(state, { data: { status: 'CREATED', progress: { phase: 'official_browser', percent } }, error: null });
    assert.equal(state.progress.percent, percent);
    assert.equal(state.pollNotice, null);
    assert.equal(state.err, null);
  }
});

// ---- scenario 9: stale/previous notice is cleared after successful recovery ----

test('scenario 9: a pollNotice set by a transient failure never leaks into `err` and is cleared by the very next successful poll', async () => {
  const state = makeInitialState('job-9');
  await simulateCheck(state, { data: null, error: makeHttpError(502, {}) });
  assert.equal(state.pollNotice, 'verify_status_poll_retrying');
  assert.equal(state.err, null, 'a transient failure must never populate the terminal error state');
  await simulateCheck(state, { data: { status: 'CREATED', progress: { percent: 50 } }, error: null });
  assert.equal(state.pollNotice, null);
  assert.equal(state.err, null);
});

// ---- scenario 10: no unhandled promise/retry race creates parallel polling loops ----

test('scenario 10: the busy-guard refuses to start a second concurrent poll for the same (or any) job', () => {
  assert.equal(shouldSkipConcurrentCheck('job-10', true), true, 'a poll already in flight must block a second one');
  assert.equal(shouldSkipConcurrentCheck('job-10', false), false);
  assert.equal(shouldSkipConcurrentCheck('', false), true, 'no job id must never poll at all');
  assert.equal(shouldSkipConcurrentCheck(null, false), true);
});
