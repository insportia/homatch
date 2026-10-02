// The object edit across two invocations (editFlow.ts), against a store whose
// writes are atomic compare-and-set on status FINISHING + lease — what the
// handler's Postgres updates are (`.eq('status', 'FINISHING').eq('lease_at', lease)`).
// The pixels are real (editPipeline.ts on small PNGs); the provider counts its calls.
//
// What must hold: one paid request per edit, whatever the polls do; a staged
// answer finished once; READY settles once and only after the final picture is
// stored; a failure is released once and never charged; a dead step is
// recovered; nothing stays FINISHING.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import {
  claimEditFinish, editNext, failEdit, runEditFinish, runEditRequest,
  EDIT_HEARTBEAT_MS, EDIT_LEASE_MS, EDIT_SILENT_MS, MAX_FINISH_ATTEMPTS,
} from '../editFlow.ts';

// ── Small real PNGs ─────────────────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function decode(bytes) {
  try {
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
    if (b[0] !== 0x89) return { ok: false, reason: 'DECODE_FAILED' };
    let p = 8; let width = 0; let height = 0; const idat = [];
    while (p < b.length) { const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8); if (type === 'IHDR') { width = b.readUInt32BE(p + 8); height = b.readUInt32BE(p + 12); } if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
    const raw = zlib.inflateSync(Buffer.concat(idat)); const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) data.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
    return { ok: true, img: { width, height, data, channels: 4 } };
  } catch { return { ok: false, reason: 'DECODE_FAILED' }; }
}
const W = 240; const H = 150; const COLOR = '#2a7f3c';
const sofa = (x, y) => x >= 100 && x < 150 && y >= 60 && y < 90;
function img(fn) { const d = new Uint8Array(W * H * 4); for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 4; const [r, g, b] = fn(x, y); d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return encodePng(d, W, H); }
const PICTURE = img((x, y) => { const v = 120 + Math.round(60 * x / W) + ((x % 60) < 3 || (y % 50) < 3 ? -80 : 0); return sofa(x, y) ? [200, 190, 170] : [v, v - 10, v - 20]; });
const IDS = img((x, y) => (sofa(x, y) ? [0x2a, 0x7f, 0x3c] : [0, 0, 0]));
const ANSWER = img((x, y) => { const v = 120 + Math.round(60 * x / W) + ((x % 60) < 3 || (y % 50) < 3 ? -80 : 0); return x >= 96 && x < 154 && y >= 56 && y < 94 ? [150, 170, 140] : [v + 1, v - 9, v - 19]; });

// ── The world: rows, objects, money, the provider, a clock ──────────────────
function world() {
  const w = {
    clock: Date.parse('2026-10-02T15:00:00.000Z'), rows: new Map(), objects: new Map(),
    providerCalls: 0, settles: [], releases: [], puts: [], removes: [], timers: [],
    answer: () => ({ ok: true, provider: 'OPENAI', model: 'gpt-image-2', bytes: ANSWER, mime: 'image/png', usage: {}, cost: { usd: 0.25, basis: 'ESTIMATED', detail: 't' }, ms: 80_000, requestId: 'r' }),
  };
  w.objects.set('picture.png', PICTURE); w.objects.set('ids.png', IDS);
  const cas = (id, lease) => { const r = w.rows.get(id); return r && r.status === 'FINISHING' && r.lease_at === lease ? r : null; };
  w.store = {
    update: async (id, lease, fields) => { const r = cas(id, lease); if (!r) return null; Object.assign(r, structuredClone(fields)); return structuredClone(r); },
    fail: async (row, lease, code, _failure, answer) => {
      const r = cas(row.id, lease); if (!r) return false;
      Object.assign(r, { status: 'FAILED', error: code, lease_at: null });
      w.releases.push({ id: r.id, code, aiUsd: answer?.cost?.usd ?? null }); return true;
    },
    settle: async (done, answer) => { w.settles.push({ id: done.id, usd: answer.cost.usd, status: w.rows.get(done.id).status, final: w.objects.has(done.final_key) }); },
    put: async (key, bytes) => { w.puts.push(key); w.objects.set(key, bytes); return true; },
    remove: async (key) => { w.removes.push(key); w.objects.delete(key); },
    stagedKey: async (row) => `staged/${row.id}.png`,
    finalKey: async (row) => `edit/${row.id}.png`,
    finishRecord: (check, answer) => ({ provider: answer.provider, check }),
    now: () => w.clock,
    every: (ms, fn) => { const t = { ms, fn, live: true }; w.timers.push(t); return () => { t.live = false; }; },
  };
  w.requestIo = (row) => ({
    readImage: async () => w.objects.get(row.base_key) ?? null, readIds: async () => w.objects.get(row.map_key) ?? null,
    decode, rgba: (i) => i.data, encodePng,
    edit: async () => { w.providerCalls += 1; return w.answer(); },
  });
  w.finishIo = (row) => ({
    readImage: async () => w.objects.get(row.base_key) ?? null, readIds: async () => w.objects.get(row.map_key) ?? null,
    readAnswer: async () => w.objects.get(row.timings?.staged?.key) ?? null, decode, rgba: (i) => i.data, encodePng,
  });
  w.insert = (id = 'e1') => {
    const lease = new Date(w.clock).toISOString();
    w.rows.set(id, { id, kind: 'EDIT', status: 'FINISHING', lease_at: lease, base_key: 'picture.png', map_key: 'ids.png', timings: { requestedAt: lease }, edit: { targetId: 'sofa' } });
    return { row: structuredClone(w.rows.get(id)), lease };
  };
  w.row = (id = 'e1') => structuredClone(w.rows.get(id));
  /** One render-status poll: what the handler does with an edit (claims and finishes in its background). */
  w.poll = async (id = 'e1', { run = true } = {}) => {
    const row = w.row(id); const next = editNext(row, w.clock);
    if (next.action === 'WAIT') return 'WAIT';
    if (next.action === 'FAIL') return (await failEdit(w.store, row, next.code)) ? `FAILED:${next.code}` : 'LOST';
    const claimed = await claimEditFinish(w.store, row, next.attempt);
    if (!claimed) return 'LOST';
    return run ? await runEditFinish(w.store, w.finishIo(claimed), claimed, COLOR) : claimed;
  };
  w.tick = (ms) => { w.clock += ms; };
  return w;
}

test('the whole edit: one paid request, staged, one poll finishes it, READY then settled once', async () => {
  const w = world();
  const { row, lease } = w.insert();
  assert.equal(await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR), 'STAGED');
  let r = w.row();
  assert.equal(r.status, 'FINISHING');
  assert.notEqual(r.lease_at, lease, 'step 1 handed the row over with a new lease');
  assert.equal(r.timings.staged.key, 'staged/e1.png');
  assert.ok(Buffer.from(w.objects.get('staged/e1.png')).equals(Buffer.from(ANSWER)), 'the answer staged unchanged');
  assert.equal(w.settles.length, 0, 'nothing settled in step 1');
  w.tick(4000);
  assert.equal(await w.poll(), 'READY');
  r = w.row();
  assert.equal(r.status, 'READY');
  assert.equal(w.providerCalls, 1);
  assert.equal(w.settles.length, 1, 'settled once');
  assert.deepEqual([w.settles[0].status, w.settles[0].final], ['READY', true], 'settled only after READY, with the final picture stored');
  assert.equal(w.releases.length, 0);
  assert.equal(w.objects.has('staged/e1.png'), false, 'the staged answer is removed after READY');
  assert.ok(decode(w.objects.get('edit/e1.png')).ok, 'the final picture is stored');
});

test('two concurrent polls: one claims, one finish, one settle — and later polls change nothing', async () => {
  const w = world();
  const { row, lease } = w.insert();
  await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR);
  w.tick(1000);
  // A true race: both polls read the same row, both decide to finish, both claim at once.
  const seen = [w.row(), w.row()];
  assert.deepEqual(seen.map((r) => editNext(r, w.clock).action), ['FINISH', 'FINISH']);
  const claims = await Promise.all(seen.map((r) => claimEditFinish(w.store, r, 1)));
  assert.equal(claims.filter(Boolean).length, 1, 'exactly one claim wins');
  assert.equal(await runEditFinish(w.store, w.finishIo(claims.find(Boolean)), claims.find(Boolean), COLOR), 'READY');
  // A poll arriving while it is claimed, or after, does nothing.
  assert.equal(await w.poll(), 'WAIT');
  for (let i = 0; i < 5; i += 1) { w.tick(4000); assert.equal(await w.poll(), 'WAIT', 'READY: nothing to do'); }
  assert.equal(w.providerCalls, 1, 'one paid request');
  assert.equal(w.puts.filter((k) => k.startsWith('edit/')).length, 1, 'one final picture');
  assert.equal(w.settles.length, 1, 'settled once');
});

test('polls while the finisher is alive wait; a dead finisher is claimed again — no new provider call', async () => {
  const w = world();
  const { row, lease } = w.insert();
  await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR);
  w.tick(1000);
  const claimed = await w.poll('e1', { run: false }); // the finisher's instance dies before finishing
  assert.equal(claimed.timings.finisher.attempt, 1);
  w.tick(EDIT_SILENT_MS - 1000);
  assert.equal(await w.poll(), 'WAIT', 'still within its heartbeat window');
  w.tick(2000);
  assert.equal(await w.poll(), 'READY', 'attempt 2 finished it');
  assert.equal(w.row().timings.finishAttempt, 2);
  assert.equal(w.providerCalls, 1, 'no second paid request');
  assert.equal(w.settles.length, 1);
});

test('a superseded finisher that wakes up changes nothing: no READY, no release, the staged answer kept for the new one', async () => {
  const w = world();
  const { row, lease } = w.insert();
  await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR);
  w.tick(1000);
  const first = await w.poll('e1', { run: false });
  w.tick(EDIT_SILENT_MS + 1000);
  const second = await w.poll('e1', { run: false });
  // The first worker was only slow: it finishes now, against its old lease.
  assert.equal(await runEditFinish(w.store, w.finishIo(first), first, COLOR), 'SUPERSEDED');
  assert.equal(w.row().status, 'FINISHING');
  assert.equal(w.settles.length, 0); assert.equal(w.releases.length, 0);
  // A failing superseded worker does not release or delete either.
  const badIo = { ...w.finishIo(first), readAnswer: async () => null };
  assert.equal(await runEditFinish(w.store, badIo, first, COLOR), 'SUPERSEDED');
  assert.equal(w.releases.length, 0);
  assert.equal(w.objects.has('staged/e1.png'), true, 'the answer is still there for the current finisher');
  assert.equal(await runEditFinish(w.store, w.finishIo(second), second, COLOR), 'READY');
  assert.equal(w.settles.length, 1);
  assert.equal(w.providerCalls, 1);
});

test(`a finish that keeps dying is ended after ${MAX_FINISH_ATTEMPTS} attempts: released once, not charged, staging removed`, async () => {
  const w = world();
  const { row, lease } = w.insert();
  await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR);
  for (let i = 0; i < MAX_FINISH_ATTEMPTS; i += 1) { w.tick(1000 + (i ? EDIT_SILENT_MS : 0)); await w.poll('e1', { run: false }); }
  w.tick(EDIT_SILENT_MS + 1000);
  assert.equal(await w.poll(), 'FAILED:EDIT_FINISH_INTERRUPTED');
  assert.equal(w.row().status, 'FAILED');
  assert.deepEqual(w.releases.map((x) => [x.code, x.aiUsd]), [['EDIT_FINISH_INTERRUPTED', 0.25]], 'released once, with the provider cost it did spend');
  assert.equal(w.settles.length, 0, 'never charged');
  assert.equal(w.objects.has('staged/e1.png'), false);
  assert.equal(await w.poll(), 'WAIT', 'FAILED: nothing more');
  assert.equal(w.providerCalls, 1);
});

test('a finish that fails (refused, unreadable) is FAILED at once: released once, not charged, no provider call', async () => {
  for (const [label, mutate] of [
    ['refused', (w) => { w.answer = () => ({ ...w.answer0(), bytes: img(() => [10, 10, 10]) }); }],
    ['staged answer lost', null],
  ]) {
    const w = world(); w.answer0 = w.answer;
    if (mutate) mutate(w);
    const { row, lease } = w.insert();
    await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR);
    if (!mutate) w.objects.delete('staged/e1.png');
    w.tick(1000);
    assert.equal(await w.poll(), 'FAILED', label);
    assert.equal(w.row().status, 'FAILED', label);
    assert.equal(w.row().error, mutate ? 'EDIT_REFUSED' : 'EDIT_STAGED_MISSING', label);
    assert.equal(w.releases.length, 1, label); assert.equal(w.settles.length, 0, label);
    assert.equal(w.providerCalls, 1, label);
  }
});

test('step 1: a dead request is failed (never re-requested); its late heartbeat cannot undo the hand-over', async () => {
  const w = world();
  const { row } = w.insert();
  // The request's instance dies before staging: no heartbeat after the first.
  w.tick(EDIT_SILENT_MS + 1000);
  assert.equal(await w.poll(), 'FAILED:EDIT_INTERRUPTED');
  assert.deepEqual(w.releases.map((x) => [x.code, x.aiUsd]), [['EDIT_INTERRUPTED', null]], 'released; the unknown spend stays unknown');
  assert.equal(w.providerCalls, 0, 'the poll never calls the provider');
  // A late beat with the old lease after a hand-over is a no-op.
  const w2 = world(); const { row: r2, lease: l2 } = w2.insert();
  await runEditRequest(w2.store, w2.requestIo(r2), r2, l2, COLOR);
  assert.equal(await w2.store.update('e1', l2, { timings: { heartbeatAt: 'late' } }), null);
  assert.ok(w2.row().timings.staged, 'the staged record survives');
  void row;
});

test('step 1 failures before the provider are released with nothing spent; the heartbeat stops', async () => {
  const w = world();
  w.objects.set('ids.png', img(() => [0, 0, 0])); // the target is not in the picture
  const { row, lease } = w.insert();
  assert.equal(await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR), 'FAILED');
  assert.equal(w.row().error, 'TARGET_NOT_VISIBLE');
  assert.equal(w.providerCalls, 0);
  assert.equal(w.releases.length, 1);
  assert.ok(w.timers.every((t) => !t.live), 'no heartbeat left running');
  assert.equal(w.timers[0].ms, EDIT_HEARTBEAT_MS);
});

test('nothing stays FINISHING: an edit nobody finishes ends at the ceiling, released, not charged', async () => {
  const w = world();
  const { row, lease } = w.insert();
  await runEditRequest(w.store, w.requestIo(row), row, lease, COLOR);
  // Polls arrive only after the ceiling (the customer left and came back).
  w.tick(EDIT_LEASE_MS + 1000);
  assert.equal(await w.poll(), 'FAILED:EDIT_TIMEOUT');
  assert.equal(w.settles.length, 0); assert.equal(w.releases.length, 1);
  assert.equal(w.objects.has('staged/e1.png'), false);
  // Every state the poll can see moves toward READY or FAILED.
  const states = [
    { timings: { requestedAt: 'T0' } }, { timings: { requestedAt: 'T0', heartbeatAt: 'T0' } },
    { timings: { requestedAt: 'T0', staged: { key: 'k' } } },
    { timings: { requestedAt: 'T0', staged: { key: 'k' }, finisher: { lease: 'T0', heartbeatAt: 'T0', attempt: 1 } } },
    { timings: { requestedAt: 'T0', staged: { key: 'k' }, finisher: { lease: 'T0', heartbeatAt: 'T0', attempt: MAX_FINISH_ATTEMPTS } } },
  ];
  const t0 = Date.parse('2026-10-02T15:00:00.000Z'); const T0 = new Date(t0).toISOString();
  for (const s of states) {
    const r = JSON.parse(JSON.stringify({ kind: 'EDIT', status: 'FINISHING', lease_at: T0, ...s }).replaceAll('"T0"', JSON.stringify(T0)));
    assert.notEqual(editNext(r, t0 + EDIT_LEASE_MS + 1).action, 'WAIT', JSON.stringify(s));
  }
});

test('editNext: the decision table', () => {
  const t0 = Date.parse('2026-10-02T15:00:00.000Z'); const at = (ms) => new Date(t0 + ms).toISOString();
  const row = (timings, over = {}) => ({ kind: 'EDIT', status: 'FINISHING', lease_at: at(0), timings: { requestedAt: at(0), ...timings }, ...over });
  assert.deepEqual(editNext(row({}), t0 + 30_000), { action: 'WAIT' }, 'step 1 just started');
  assert.deepEqual(editNext(row({ heartbeatAt: at(90_000) }), t0 + 95_000), { action: 'WAIT' }, 'step 1 beating while the provider is waited for');
  assert.deepEqual(editNext(row({ heartbeatAt: at(4 * 60_000) }), t0 + 4 * 60_000 + 5_000), { action: 'WAIT' }, 'a slow provider with a living step 1');
  assert.deepEqual(editNext(row({}), t0 + EDIT_SILENT_MS + 1), { action: 'FAIL', code: 'EDIT_INTERRUPTED' }, 'step 1 never beat');
  assert.deepEqual(editNext(row({ heartbeatAt: at(90_000) }), t0 + 90_000 + EDIT_SILENT_MS + 1), { action: 'FAIL', code: 'EDIT_INTERRUPTED' }, 'step 1 killed after its last beat');
  const staged = { staged: { key: 'k' } };
  const handed = { lease_at: at(100_000) };
  assert.deepEqual(editNext(row(staged, handed), t0 + 100_500), { action: 'FINISH', attempt: 1 }, 'staged and unclaimed: finish now');
  const fin = (beat, attempt) => ({ ...staged, finisher: { lease: at(100_000), heartbeatAt: at(beat), attempt } });
  assert.deepEqual(editNext(row(fin(110_000, 1), handed), t0 + 120_000), { action: 'WAIT' }, 'finisher alive');
  assert.deepEqual(editNext(row(fin(110_000, 1), handed), t0 + 110_000 + EDIT_SILENT_MS + 1), { action: 'FINISH', attempt: 2 }, 'finisher dead: claim again');
  assert.deepEqual(editNext(row(fin(110_000, MAX_FINISH_ATTEMPTS), handed), t0 + 110_000 + EDIT_SILENT_MS + 1), { action: 'FAIL', code: 'EDIT_FINISH_INTERRUPTED' });
  assert.deepEqual(editNext(row({ heartbeatAt: at(EDIT_LEASE_MS) }), t0 + EDIT_LEASE_MS + 1), { action: 'FAIL', code: 'EDIT_TIMEOUT' }, 'the ceiling holds even while beating');
  assert.deepEqual(editNext(row(fin(EDIT_LEASE_MS, 1), handed), t0 + EDIT_LEASE_MS + 1), { action: 'FAIL', code: 'EDIT_TIMEOUT' }, '…and while finishing; measured from the request, not the rotated lease');
  for (const over of [{ status: 'READY' }, { status: 'FAILED' }, { kind: 'MASTER' }, { lease_at: null }]) assert.deepEqual(editNext(row({}, over), t0 + EDIT_LEASE_MS * 2), { action: 'WAIT' }, JSON.stringify(over));
});

test('the handler wires the steps to compare-and-set writes, one finish per poll, and settles only after READY', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-reconstruct/renders.ts'), 'utf8');
  const store = src.slice(src.indexOf('function editStore('), src.indexOf('function editStore(') + 2200);
  assert.match(store, /update: async \(rowId, lease, fields\) => \{[\s\S]*?\.eq\('id', rowId\)\.eq\('status', 'FINISHING'\)\.eq\('lease_at', lease\)/);
  assert.match(store, /fail: \(r, lease, code, failure, answer\) => failRender\([\s\S]*?\['FINISHING'\], lease\)/);
  const fr = src.slice(src.indexOf('async function failRender'), src.indexOf('async function failRender') + 1200);
  assert.match(fr, /if \(lease\) q = q\.eq\('lease_at', lease\)/);
  assert.ok(fr.indexOf('if (!claimed?.length) return false;') < fr.indexOf('closeBilling('), 'release only by the claim winner');
  const status = src.slice(src.indexOf('export async function handleRenderStatus'), src.indexOf('export async function handleRenderStatus') + 2600);
  assert.match(status, /const next = editNext\(row, nowMs\);/);
  assert.match(status, /if \(budget\.finishes <= 0\) continue;\s*const claimed = await claimEditFinish\(store, row, next\.attempt\);\s*if \(!claimed\) continue;[\s\S]*?budget\.finishes -= 1;/);
  assert.match(status, /runEditFinish\(store, editFinishIo\(claimed\), claimed, editColor\(claimed\)\)/);
  const edit = src.slice(src.indexOf('export async function handleRenderEdit'));
  assert.match(edit, /runEditRequest\(store, \{/);
  assert.doesNotMatch(edit, /closeBilling\(/, 'render-edit never settles');
  const flow = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/designStudio/editFlow.ts'), 'utf8');
  const finish = flow.slice(flow.indexOf('export async function runEditFinish'));
  assert.ok(finish.indexOf("status: 'READY'") < finish.indexOf('store.settle('), 'settle after READY');
  assert.match(finish, /if \(!done\) return 'SUPERSEDED';\s*await store\.settle\(done, answer\);/);
  assert.doesNotMatch(finish.slice(0, finish.indexOf('export async function failEdit')), /\.edit\(/, 'step 2 never calls the provider');
});
