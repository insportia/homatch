// Durable Verify queue, worker side: lane runner (free-slot claims, heartbeat
// fencing, graceful release), evidence compaction (complete text stored, never
// lost) and the source executor (TAS parcel delegation, human-required, retry).
// Fake gateway throughout: no network, no database, no paid CAPTCHA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueRunner, withExecStamp } from '../.tstest-build/queue/QueueRunner.js';
import { compactResult, DOC_EXCERPT_CHARS, TOTAL_EXCERPT_CHARS, MAX_RESULT_CHARS, sha256 } from '../.tstest-build/queue/evidence.js';
import { createVerifyExecutor } from '../.tstest-build/queue/executor.js';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await tick();
  }
};

let seq = 0;
const mkTask = (o = {}) => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, jobId: '11111111-1111-4111-8111-111111111111',
  source: 'mygov', lane: 'HTTP', dedupeKey: 'mygov', scopeKey: 'mygov:01.18', input: { cadastral: '01.18.06.019.055.03.01.503' },
  state: 'RUNNING', attempts: 1, maxAttempts: 4, fencingToken: 1, leaseSeconds: 900, ...o,
});

function fakeGateway({ queue = [], heartbeat = () => 'OK' } = {}) {
  const calls = { claim: [], complete: [], fail: [], release: [], delegate: [], captcha: [], upload: [], heartbeat: 0 };
  return {
    calls,
    async claim(worker, lanes, limit) {
      calls.claim.push({ lanes, limit });
      return { tasks: queue.splice(0, limit) };
    },
    async heartbeat(t) { calls.heartbeat++; return { state: heartbeat(t) }; },
    async complete(t, p) { calls.complete.push({ id: t.id, ...p }); return { ok: true }; },
    async fail(t, error, retryable) { calls.fail.push({ id: t.id, error, retryable }); return { ok: true }; },
    async release(t) { calls.release.push(t.id); return { released: true }; },
    async delegate(t, scopeKey, input) { calls.delegate.push({ id: t.id, scopeKey, input }); return { ok: true, outcome: this.delegateOutcome ?? 'SHARED' }; },
    async captcha(events) { calls.captcha.push(...events); return { recorded: events.length }; },
    async upload(sha, ct, body) { calls.upload.push({ sha, ct, chars: body.length }); return `sha256/${sha.slice(0, 2)}/${sha}.txt`; },
  };
}

const runner = (gateway, executor, extra = {}) => new QueueRunner({
  gateway, executor, workerId: 'test-1', lanes: { HTTP: 2 }, idleMinMs: 5, idleMaxMs: 20, sleep: tick, heartbeatMinMs: 5, ...extra,
});

test('a lane claims only its free slots and never holds work it cannot start', async () => {
  const gw = fakeGateway({ queue: [mkTask(), mkTask(), mkTask(), mkTask()] });
  const gates = [];
  const r = runner(gw, () => new Promise((res) => gates.push(() => res({ type: 'complete', result: { ok: true } }))));
  r.start();
  await until(() => gates.length === 2);
  await tick(40);
  assert.equal(gates.length, 2, 'two slots → two running tasks');
  assert.equal(gw.calls.claim[0].limit, 2);
  assert.ok(gw.calls.claim.every((c) => c.limit <= 2));
  gates.shift()();
  await until(() => gates.length === 2 && gw.calls.complete.length === 1);
  assert.ok(gw.calls.claim.some((c) => c.limit === 1), 'one freed slot → claim of one');
  for (const g of gates.splice(0)) g();
  await until(() => gates.length === 1);
  gates.shift()();
  await until(() => gw.calls.complete.length === 4);
  await r.stop(100);
  assert.equal(r.counters.completed, 4);
  assert.equal(gw.calls.release.length, 0);
});

test('a lost lease aborts the task and nothing is written for it (fencing)', async () => {
  const gw = fakeGateway({ queue: [mkTask({ leaseSeconds: 0.03 })], heartbeat: () => 'LOST' });
  let aborted = false;
  const r = runner(gw, (t, ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => { aborted = true; rej(ctx.signal.reason); })));
  r.start();
  await until(() => aborted);
  await tick(30);
  await r.stop(100);
  assert.equal(r.counters.lost, 1);
  assert.equal(gw.calls.complete.length + gw.calls.fail.length, 0, 'stale holder writes nothing');
});

test('a cancelled task ends as a non-retryable CANCELLED failure', async () => {
  const gw = fakeGateway({ queue: [mkTask({ leaseSeconds: 0.03 })], heartbeat: () => 'CANCEL' });
  const r = runner(gw, (t, ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(ctx.signal.reason))));
  r.start();
  await until(() => gw.calls.fail.length === 1);
  await r.stop(100);
  assert.deepEqual(gw.calls.fail[0].error, 'CANCELLED');
  assert.equal(gw.calls.fail[0].retryable, false);
});

test('an executor crash becomes a retryable failure, not a lost task', async () => {
  const gw = fakeGateway({ queue: [mkTask()] });
  const r = runner(gw, async () => { throw new Error('socket hang up'); });
  r.start();
  await until(() => gw.calls.fail.length === 1);
  await r.stop(100);
  assert.equal(gw.calls.fail[0].retryable, true);
  assert.match(gw.calls.fail[0].error, /socket hang up/);
});

test('a wedged attempt is bounded: past the deadline it is aborted, retried later, and its slot is freed', async () => {
  const gw = fakeGateway({ queue: [mkTask(), mkTask()] });
  let aborted = 0;
  let started = 0;
  /* The first attempt never answers (a page with no step deadline); the second completes. */
  const r = runner(gw, (t, ctx) => {
    started++;
    ctx.signal.addEventListener('abort', () => { aborted++; });
    return started === 1 ? new Promise(() => {}) : Promise.resolve({ type: 'complete', result: { ok: true } });
  }, { lanes: { HTTP: 1 }, taskDeadlineMs: 40 });
  const alive = setInterval(() => {}, 10);
  r.start();
  await until(() => gw.calls.fail.length === 1 && gw.calls.complete.length === 1);
  clearInterval(alive);
  await r.stop(100);
  assert.deepEqual(gw.calls.fail[0], { id: gw.calls.fail[0].id, error: 'TASK_DEADLINE', retryable: true }, 'retryable: the queue backs off and ends in DEAD after max attempts');
  assert.equal(aborted, 1, 'the wedged attempt was told to stop');
  assert.equal(r.counters.deadlines, 1);
  assert.equal(gw.calls.complete.length, 1, 'the one slot was freed for the next task');
});

test('shutdown stops claiming and releases unfinished tasks without writing results', async () => {
  const gw = fakeGateway({ queue: [mkTask(), mkTask(), mkTask()] });
  const r = runner(gw, (t, ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(ctx.signal.reason))));
  r.start();
  await until(() => r.inFlight() === 2);
  const claimsBefore = gw.calls.claim.length;
  await r.stop(20);
  await tick(30);
  assert.equal(gw.calls.release.length, 2);
  assert.equal(r.counters.released, 2);
  assert.equal(gw.calls.complete.length + gw.calls.fail.length, 0);
  assert.equal(gw.calls.claim.length, claimsBefore, 'no claim after stop');
});

test('evidence: complete text of a long document is stored; the result keeps an honest excerpt', async () => {
  const gw = fakeGateway();
  const long = 'ა'.repeat(DOC_EXCERPT_CHARS * 3);
  const short = 'short document text that fits';
  const raw = { status: 'SEARCH_CONFIRMED', documents: [
    { id: 'd1', title: 'permit', documentDate: '2024-01-01', rawText: long.slice(0, 100), fullText: long },
    { id: 'd2', title: 'note', documentDate: '2023-01-01', rawText: short },
  ] };
  const c = await compactResult(raw, (sha, ct, body) => gw.upload(sha, ct, body));
  const [d1, d2] = c.result.documents;
  assert.equal(gw.calls.upload.length, 1);
  assert.equal(gw.calls.upload[0].chars, long.length, 'the whole document is stored');
  assert.equal(gw.calls.upload[0].sha, sha256(long));
  assert.equal(d1.rawText.length, DOC_EXCERPT_CHARS);
  assert.equal(d1.textTruncated, true);
  assert.deepEqual(d1.fullTextRef, { sha256: sha256(long), path: c.evidenceRefs[0].path, chars: long.length });
  assert.equal('fullText' in d1, false, 'the full body never travels in the result');
  assert.equal(d2.rawText, short);
  assert.equal(d2.textTruncated, false);
  assert.equal(d2.fullTextRef, undefined);
  assert.equal(c.contentHash, sha256(JSON.stringify(c.result)));
});

test('evidence: the excerpt budget favours the newest documents and nothing is dropped', async () => {
  const gw = fakeGateway();
  const n = Math.ceil(TOTAL_EXCERPT_CHARS / DOC_EXCERPT_CHARS) + 5;
  const docs = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, documentDate: `20${String(10 + i).padStart(2, '0')}-01-01`, fullText: `${i}:`.padEnd(DOC_EXCERPT_CHARS + 10, 'x') }));
  const c = await compactResult({ documents: docs }, (sha, ct, body) => gw.upload(sha, ct, body));
  assert.equal(c.stats.excerptChars <= TOTAL_EXCERPT_CHARS, true);
  assert.equal(gw.calls.upload.length, n, 'every document is stored in full');
  const newest = c.result.documents.find((d) => d.id === `d${n - 1}`);
  const oldest = c.result.documents.find((d) => d.id === 'd0');
  assert.equal(newest.rawText.length, DOC_EXCERPT_CHARS);
  assert.equal(oldest.rawText.length, 0);
  assert.equal(oldest.textTruncated, true);
  assert.ok(oldest.fullTextRef.path);
});

test('evidence: an oversized structured result is stored whole before it is trimmed', async () => {
  const gw = fakeGateway();
  const records = Array.from({ length: 6000 }, (_, i) => ({ i, blob: "y".repeat(400) })); // > 2 MB
  const c = await compactResult({ traversal: { records } }, (sha, ct, body) => gw.upload(sha, ct, body));
  assert.equal(c.stats.trimmedStructure, true);
  assert.equal(gw.calls.upload.length, 1);
  assert.ok(gw.calls.upload[0].chars > MAX_RESULT_CHARS);
  assert.equal(c.result.traversal.records.length, 60);
  assert.equal(c.result.fullResultRef.chars, gw.calls.upload[0].chars);
  assert.ok(JSON.stringify(c.result).length < MAX_RESULT_CHARS);
});

test('evidence: the bound is UTF-8 bytes — a Georgian-heavy priority result fits the queue body', async () => {
  // verify-queue refuses a body over 2.5 MB; Georgian is 3 bytes per character.
  const gw = fakeGateway();
  const geo = 'ქართული ტექსტი '.repeat(40_000); // ~600k characters, ~1.6 MB UTF-8
  const docs = [
    { id: 'p1', priority: 1, rawText: geo, textComplete: true },
    { id: 'p2', priority: 2, rawText: geo, textComplete: true },
  ];
  const c = await compactResult({ documents: docs, traversal: { records: [] } }, (sha, ct, body) => gw.upload(sha, ct, body));
  const bytes = Buffer.byteLength(JSON.stringify(c.result), 'utf8');
  assert.ok(bytes <= MAX_RESULT_CHARS, `result is ${bytes} bytes`);
  assert.ok(bytes < 2_500_000, 'would be refused by verify-queue');
  const trimmed = c.result.documents.filter((d) => d.inlineTrimmedForSize);
  assert.ok(trimmed.length >= 1, 'oversized priority text gives way inline');
  for (const d of trimmed) assert.equal(d.textComplete, false, 'an inline-trimmed text never claims completeness');
  assert.ok(c.result.fullResultRef?.path, 'the complete result is stored before trimming');
});

const noBrowser = { launchBrowser: async () => { throw new Error('no browser in this test'); }, closeBrowser: async () => {} };
const ctxFor = (gw) => ({ signal: new AbortController().signal, gateway: gw, workerId: 'test-1' });

test('executor: a TAS flat resolving to its parcel delegates to the shared parcel scope', async () => {
  const gw = fakeGateway();
  let acquired = 0;
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: { executeSource: async () => ({ result: {}, keep: false }) },
    tas: { probe: async () => ({ code: '01.18.06.019.055', tried: [] }), acquire: async () => { acquired++; throw new Error('unused'); } } });
  const t = mkTask({ source: 'tas', scopeKey: 'tas:01.18.06.019.055.03.01.503' });
  const out = await exec(t, ctxFor(gw));
  assert.deepEqual(out, { type: 'delegated' });
  assert.equal(gw.calls.delegate[0].scopeKey, 'tas:01.18.06.019.055');
  assert.equal(gw.calls.delegate[0].input.resolved, true);
  assert.equal(acquired, 0, 'the parcel is read once, by its producer');
});

test('executor: the first flat of a building becomes the parcel producer and reads the parcel', async () => {
  const gw = fakeGateway();
  gw.delegateOutcome = 'PRODUCE';
  const queried = [];
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: { executeSource: async () => ({ result: {}, keep: false }) },
    tas: { probe: async () => ({ code: '01.18.06.019.055', tried: [] }), acquire: async (q) => { queried.push(q); throw new Error('stop after acquire'); } } });
  await assert.rejects(exec(mkTask({ source: 'tas' }), ctxFor(gw)), /stop after acquire/);
  assert.deepEqual(queried, ['01.18.06.019.055']);
});

test('executor: human verification is final, a failed source is retried, success stores evidence', async () => {
  const gw = fakeGateway();
  const outs = [
    { result: { status: 'CAPTCHA_REQUIRED' }, keep: false },
    { result: { status: 'FAILED', error: 'timeout' }, keep: false },
    { result: { status: 'SEARCH_CONFIRMED', documents: [{ id: 'x', fullText: 'z'.repeat(DOC_EXCERPT_CHARS + 1) }] }, keep: false },
  ];
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: {}, mygov: async () => outs.shift() });
  assert.deepEqual(await exec(mkTask(), ctxFor(gw)), { type: 'fail', error: 'HUMAN_VERIFICATION_REQUIRED:NONE sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_NONE', retryable: false });
  assert.deepEqual(await exec(mkTask(), ctxFor(gw)), { type: 'fail', error: 'timeout sourceOutcome=PROVIDER_UNAVAILABLE reason=FAILED', retryable: true });
  const ok = await exec(mkTask(), ctxFor(gw));
  assert.equal(ok.type, 'complete');
  assert.equal(ok.cacheScope, 'mygov:01.18');
  assert.equal(ok.evidenceRefs.length, 1);
  assert.equal(gw.calls.upload[0].chars, DOC_EXCERPT_CHARS + 1);
});

test('executor: browser sources get their own Chromium, always closed; unknown sources are final', async () => {
  const gw = fakeGateway();
  const launched = [];
  const closed = [];
  const steps = [];
  const exec = createVerifyExecutor({
    launchBrowser: async (id) => { launched.push(id); return { id }; },
    closeBrowser: async (b) => { closed.push(b.id); },
    orchestrator: { executeSource: async (b, spec) => { steps.push(spec.step); if (spec.step.source === 'debtor') throw new Error('page crashed'); return { result: { status: 'NO_RESULT_CONFIRMED' }, keep: false }; } },
  });
  const enreg = mkTask({ source: 'enreg', lane: 'BROWSER', input: { idCode: '404670272', name: 'Millenio Group' } });
  assert.equal((await exec(enreg, ctxFor(gw))).type, 'complete');
  await assert.rejects(exec(mkTask({ source: 'debtor', lane: 'BROWSER', input: { idCode: '404670272' } }), ctxFor(gw)), /page crashed/);
  assert.equal(launched.length, 2);
  assert.deepEqual(closed, launched, 'every Chromium is closed, including after a crash');
  assert.deepEqual(steps[0], { type: 'entity', source: 'enreg', idCode: '404670272', name: 'Millenio Group' });
  assert.deepEqual(await exec(mkTask({ source: 'nope' }), ctxFor(gw)), { type: 'fail', error: 'UNKNOWN_SOURCE nope', retryable: false });
});

test('executor: a transient CAPTCHA give-up gets ONE fresh retry; a rejection or a second give-up is final', async () => {
  const gw = fakeGateway();
  const noChange = { result: { status: 'WAITING_HUMAN', captchaResolution: [{ outcome: 'NO_CHANGE' }] }, keep: false };
  const rejected = { result: { status: 'WAITING_HUMAN', captchaResolution: [{ outcome: 'REJECTED' }] }, keep: false };
  const outs = [noChange, noChange, rejected];
  const exec = createVerifyExecutor({ ...noBrowser, orchestrator: {}, mygov: async () => outs.shift() });
  assert.deepEqual(await exec(mkTask({ attempts: 1 }), ctxFor(gw)), { type: 'fail', error: 'CAPTCHA_NO_CHANGE sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_NO_CHANGE', retryable: true, retryAfterSeconds: 20 });
  assert.deepEqual(await exec(mkTask({ attempts: 2 }), ctxFor(gw)), { type: 'fail', error: 'HUMAN_VERIFICATION_REQUIRED:NO_CHANGE sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_NO_CHANGE', retryable: false });
  assert.deepEqual(await exec(mkTask({ attempts: 1 }), ctxFor(gw)), { type: 'fail', error: 'HUMAN_VERIFICATION_REQUIRED:REJECTED sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_REJECTED', retryable: false });
});

test('a completed result carries the final attempt\'s execution span (performance only)', async () => {
  const gw = fakeGateway({ queue: [mkTask({ attempts: 2 })] });
  const r = runner(gw, async () => { await tick(15); return { type: 'complete', result: { status: 'SEARCH_CONFIRMED' } }; });
  r.start();
  await until(() => gw.calls.complete.length === 1);
  await r.stop(100);
  const done = gw.calls.complete[0];
  assert.equal(done.result.status, 'SEARCH_CONFIRMED', 'the result itself is untouched');
  assert.equal(done.result._exec.attempt, 2);
  assert.ok(done.result._exec.ms >= 10);
  assert.ok(Date.parse(done.result._exec.finishedAt) >= Date.parse(done.result._exec.startedAt));
  // Non-object results pass through unchanged.
  const raw = { type: 'complete', result: null };
  assert.equal(withExecStamp(raw, { attempts: 1 }, new Date()), raw);
});

// ── RS.ge (rstax): every outcome stores RS.ge's answer; only VERIFIED completes ──
test('executor (rstax): the redacted answer is stored as evidence on EVERY outcome; only VERIFIED completes; one retry for transient', async () => {
  const gw = fakeGateway();
  const rec = (status, serverOutcome, httpStatus = 200) => ({ status, serverOutcome, httpStatus, responseFormat: 'JSON', rowCount: 1, columns: ['Name'], rawResponse: '{"Data":[{"TaxPayerID":"40*****72","Name":"შპს ტესტი"}]}', rawResponseBytes: 60, rawTruncated: false, requestHadTin: true, reason: null, checkedAt: '2026-10-11T10:00:00.000Z', sourceUrl: 'https://www.rs.ge/TaxpayersRegistry' });
  const outs = [
    { result: { source: 'rstax', status: 'SEARCH_CONFIRMED', documents: [], taxpayerData: { taxpayerName: 'შპს ტესტი' }, rsVerification: rec('VERIFIED', 'ACCEPTED') }, keep: false },
    { result: { source: 'rstax', status: 'WAITING_HUMAN', captchaResolution: [{ outcome: 'REJECTED' }], rsVerification: rec('VERIFICATION_FAILED', 'REJECTED') }, keep: true },
    { result: { source: 'rstax', status: 'TEMPORARILY_UNAVAILABLE', rsVerification: rec('TEMPORARILY_UNAVAILABLE', 'HTTP_ERROR', 503) }, keep: false },
    { result: { source: 'rstax', status: 'TEMPORARILY_UNAVAILABLE', rsVerification: rec('TEMPORARILY_UNAVAILABLE', 'NETWORK_ERROR', null) }, keep: false },
    { result: { source: 'rstax', status: 'FAILED', error: 'navigation timeout' }, keep: false },
    { result: { source: 'rstax', status: 'WAITING_HUMAN', captchaResolution: [{ outcome: 'DISABLED' }], rsVerification: rec('PENDING_VERIFICATION', 'NOT_SEARCHED', null) }, keep: true },
  ];
  const exec = createVerifyExecutor({
    launchBrowser: async (id) => ({ id }), closeBrowser: async () => {},
    orchestrator: { executeSource: async () => outs.shift() },
  });
  const rs = (o = {}) => mkTask({ source: 'rstax', lane: 'BROWSER', dedupeKey: 'rstax:404670272', scopeKey: 'rstax:404670272', input: { idCode: '404670272', name: 'M' }, ...o });

  const ok = await exec(rs(), ctxFor(gw));
  assert.equal(ok.type, 'complete');
  assert.equal(ok.cacheScope, 'rstax:404670272');
  assert.equal(ok.result.rsVerification.rawResponse, undefined, 'the raw answer never travels in the result');
  assert.match(ok.result.rsVerification.rawResponseRef.sha256, /^[0-9a-f]{64}$/);
  assert.ok(ok.evidenceRefs.some((r) => r.sha256 === ok.result.rsVerification.rawResponseRef.sha256 && r.contentType === 'application/json'));

  const rejected = await exec(rs(), ctxFor(gw));
  assert.equal(rejected.type, 'fail');
  assert.equal(rejected.retryable, false);
  assert.match(rejected.error, /^RS_VERIFICATION_FAILED rs=VERIFICATION_FAILED outcome=REJECTED http=200 evidence=[0-9a-f]{64} sourceOutcome=CAPTCHA_BLOCKED reason=CAPTCHA_REJECTED$/);

  const transient = await exec(rs({ attempts: 1 }), ctxFor(gw));
  assert.deepEqual({ ...transient, error: transient.error.replace(/ evidence=.*/, '') }, { type: 'fail', error: 'RS_TEMPORARILY_UNAVAILABLE rs=TEMPORARILY_UNAVAILABLE outcome=HTTP_ERROR http=503', retryable: true, retryAfterSeconds: 30 });
  const second = await exec(rs({ attempts: 2 }), ctxFor(gw));
  assert.equal(second.retryable, false, 'at most one retry');
  const crash = await exec(rs({ attempts: 2 }), ctxFor(gw));
  assert.deepEqual(crash, { type: 'fail', error: 'RS_TEMPORARILY_UNAVAILABLE rs=TEMPORARILY_UNAVAILABLE outcome=NONE http=- sourceOutcome=PROVIDER_UNAVAILABLE reason=NO_RESPONSE', retryable: false });
  const pending = await exec(rs(), ctxFor(gw));
  assert.match(pending.error, /^HUMAN_VERIFICATION_REQUIRED:DISABLED rs=PENDING_VERIFICATION /);
  assert.equal(pending.retryable, false);

  // Five answers stored (the crash had none), each a JSON evidence object.
  assert.equal(gw.calls.upload.filter((u) => u.ct === 'application/json').length, 5);
});

test('prod eacaf5a0: a refused or unanswered hand-off is sent again as the minimal result — a finished source is never lost', async () => {
  const { handoffMinimum, HANDOFF_MIN_BYTES, MAX_RESULT_BYTES, QUEUE_MAX_RESULT_CHARS } = await import('../.tstest-build/queue/evidence.js');
  const { MAX_RESULT_STRING_CHARS } = await import('../.tstest-build/queue/evidence.js');
  assert.ok(MAX_RESULT_STRING_CHARS < QUEUE_MAX_RESULT_CHARS, 'the worker trims below the queue character limit');
  assert.ok(MAX_RESULT_BYTES <= 2_000_000);
  const gw = fakeGateway({ queue: [mkTask()] });
  let first = true;
  const sent = [];
  gw.complete = async (t, p) => {
    sent.push(p);
    if (first) { first = false; throw new Error('verify-queue complete: HTTP 413 RESULT_TOO_LARGE'); }
    gw.calls.complete.push({ id: t.id, ...p });
    return { ok: true };
  };
  const big = { status: 'SEARCH_CONFIRMED', resultConfirmed: true, traversal: { records: Array.from({ length: 400 }, (_, i) => ({ i, raw: 'x'.repeat(4000) })) }, documents: Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, complete: true, rawText: 'ტ'.repeat(8000), fullTextRef: { sha256: 'a'.repeat(64), path: 'p', chars: 9000 } })) };
  const r = runner(gw, async () => ({ type: 'complete', result: big }));
  r.start();
  await until(() => gw.calls.complete.length === 1);
  await r.stop(50);
  assert.equal(sent.length, 2);
  const minimal = sent[1].result;
  assert.equal(minimal.handoffMinimum, true);
  assert.equal(minimal.status, 'SEARCH_CONFIRMED');
  assert.equal(minimal.documents.length, 30, 'every document stays, with its stored-text ref');
  assert.ok(minimal.documents.every((d) => d.fullTextRef), 'every document keeps its stored full text');
  assert.ok(minimal.documents.slice(0, 5).every((d) => d.rawText.length >= minimal.documents[29].rawText.length), 'the newest keep the most text');
  assert.equal(minimal.traversal, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(minimal)) <= HANDOFF_MIN_BYTES);
  // Any size, any script: always under the guarantee.
  const huge = { ...big, documents: Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, rawText: 'ტ'.repeat(20000) })) };
  assert.ok(Buffer.byteLength(JSON.stringify(handoffMinimum(huge))) <= HANDOFF_MIN_BYTES);
});

test('prod eacaf5a0: a mostly-Latin result under 2 MB but over the queue character limit is trimmed before it is sent', async () => {
  const { QUEUE_MAX_RESULT_CHARS } = await import('../.tstest-build/queue/evidence.js');
  const uploads = [];
  const upload = async (sha) => { uploads.push(sha); return `sha256/${sha}`; };
  const r = { status: 'SEARCH_CONFIRMED', traversal: { records: Array.from({ length: 500 }, (_, i) => ({ i, raw: 'x'.repeat(3500) })) }, documents: [] };
  const c = await compactResult(r, upload);
  assert.ok(JSON.stringify(c.result).length < QUEUE_MAX_RESULT_CHARS, `${JSON.stringify(c.result).length} chars`);
  assert.ok(c.result.fullResultRef, 'the complete result is stored first');
});
