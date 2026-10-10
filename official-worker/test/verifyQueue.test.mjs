// Durable Verify queue, worker side: lane runner (free-slot claims, heartbeat
// fencing, graceful release), evidence compaction (complete text stored, never
// lost) and the source executor (TAS parcel delegation, human-required, retry).
// Fake gateway throughout: no network, no database, no paid CAPTCHA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueRunner } from '../.tstest-build/queue/QueueRunner.js';
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
  const records = Array.from({ length: 4000 }, (_, i) => ({ i, blob: 'y'.repeat(400) }));
  const c = await compactResult({ traversal: { records } }, (sha, ct, body) => gw.upload(sha, ct, body));
  assert.equal(c.stats.trimmedStructure, true);
  assert.equal(gw.calls.upload.length, 1);
  assert.ok(gw.calls.upload[0].chars > MAX_RESULT_CHARS);
  assert.equal(c.result.traversal.records.length, 60);
  assert.equal(c.result.fullResultRef.chars, gw.calls.upload[0].chars);
  assert.ok(JSON.stringify(c.result).length < MAX_RESULT_CHARS);
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
  assert.deepEqual(await exec(mkTask(), ctxFor(gw)), { type: 'fail', error: 'HUMAN_VERIFICATION_REQUIRED', retryable: false });
  assert.deepEqual(await exec(mkTask(), ctxFor(gw)), { type: 'fail', error: 'timeout', retryable: true });
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
