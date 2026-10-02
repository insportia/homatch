// The object edit at production size (2400×1504), with real PNG bytes, and how
// much image memory it holds at each stage.
//
// Production (edge v19, render 5ca68781): the edge runtime killed an edit for
// memory (113 MB total, 99 MB image buffers) after OpenAI answered. This file
// runs the shipped pipeline (editPixels) and, for comparison, the v19 sequence
// replicated step for step (legacyEdit below), through the same codec, the same
// provider stand-in (which keeps a copy of the request like a Blob, and encodes
// the mask the way the OpenAI provider does) and the same probes. A probe
// collects garbage and reads process.memoryUsage().arrayBuffers: what is still
// reachable at that stage — the buffers the pipeline owns, not a counter.
// Codec-internal transients (inflate/deflate) are the same in both and are not
// sampled. Final pictures are compared byte for byte: only lifetimes changed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { editPixels, editRecovery, EDIT_LEASE_MS, EDIT_SILENT_MS } from '../editPipeline.ts';
import { checkEdit, compositeInsideMask, compositeInsideMaskInto, maskFromIds, resizeMask, rgbToGray } from '../renderCheck.ts';
import { openAiMaskRgba } from '../imageProviders.ts';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const MB = 1024 * 1024;

// ── A real PNG codec (8-bit RGBA, filter 0), standing in for fast-png ──────

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
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}
function decode(bytes) {
  try {
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
    if (b[0] !== 0x89 || b[1] !== 0x50) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
    let p = 8; let width = 0; let height = 0; const idat = [];
    while (p < b.length) {
      const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8);
      if (type === 'IHDR') { width = b.readUInt32BE(p + 8); height = b.readUInt32BE(p + 12); }
      if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
      p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      if (raw[y * (width * 4 + 1)] !== 0) return { ok: false, reason: 'DECODE_FAILED' };
      data.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
    }
    return { ok: true, img: { width, height, data, channels: 4 } };
  } catch {
    return { ok: false, reason: 'DECODE_FAILED' };
  }
}
const rgba = (img) => img.data; // decode always gives RGBA (as decodeRgba does)

// ── A 2400×1504 home picture, its id picture, and the model's answer ───────

const W = 2400; const H = 1504;
const SOFA = '#2a7f3c'; const SOFA_RGB = [0x2a, 0x7f, 0x3c];
const TABLE_RGB = [0x55, 0x66, 0x77];
const sofa = { x0: 1100, y0: 600, x1: 1500, y1: 860 };
const table = { x0: 1500, y0: 600, x1: 1700, y1: 860 }; // touches the sofa: the mask must not take it beyond the 2 px seam
const inRect = (r, x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

function picture() {
  const d = new Uint8Array(W * H * 4); let s = 12345;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    s = (s * 1103515245 + 12345) >>> 0;
    const n = (s >>> 24) % 9 - 4;
    const wall = (x % 600) < 12 || (y % 500) < 12 ? -90 : 0; // structure: edges the check compares
    const base = 150 + Math.round(60 * x / W) + wall + n;
    const i = (y * W + x) * 4;
    d[i] = base; d[i + 1] = base - 10; d[i + 2] = base - 25; d[i + 3] = 255;
    if (inRect(sofa, x, y)) { d[i] = 200; d[i + 1] = 190; d[i + 2] = 170; }
  }
  return { width: W, height: H, data: d, channels: 4 };
}
function idPicture() {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4; d[i + 3] = 255;
    const c = inRect(sofa, x, y) ? SOFA_RGB : inRect(table, x, y) ? TABLE_RGB : null;
    if (c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; }
  }
  return { width: W, height: H, data: d, channels: 4 };
}
/** The model's answer: the sofa repainted sage (spilling 6 px), and the whole frame drifted +2 (models re-render). */
function answer(pic) {
  const d = new Uint8Array(pic.data);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    const spill = x >= sofa.x0 - 6 && x < sofa.x1 + 6 && y >= sofa.y0 - 6 && y < sofa.y1 + 6;
    if (spill) { d[i] = 150; d[i + 1] = 170; d[i + 2] = 140; } else { d[i] = Math.min(255, d[i] + 2); d[i + 1] = Math.min(255, d[i + 1] + 2); d[i + 2] = Math.min(255, d[i + 2] + 2); }
  }
  return { width: W, height: H, data: d, channels: 4 };
}
function nearest(img, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / w));
      out.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out, channels: 4 };
}

// Fixtures live on disk: every read is a fresh buffer the test itself does not hold.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-edit-'));
const FILES = (() => {
  const pic = picture(); const ids = idPicture(); const ans = answer(pic);
  const f = { image: path.join(DIR, 'image.png'), ids: path.join(DIR, 'ids.png'), same: path.join(DIR, 'answer.png'), small: path.join(DIR, 'answer-1600.png') };
  fs.writeFileSync(f.image, encodePng(pic.data, W, H));
  fs.writeFileSync(f.ids, encodePng(ids.data, W, H));
  fs.writeFileSync(f.same, encodePng(ans.data, W, H));
  const small = nearest(ans, 1600, 1003);
  fs.writeFileSync(f.small, encodePng(small.data, small.width, small.height));
  return f;
})();
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const ok = (bytes) => ({ ok: true, provider: 'OPENAI', model: 'gpt-image-2', bytes, mime: 'image/png', usage: { inputTextTokens: 1, inputImageTokens: 1, cachedInputTokens: 0, outputImageTokens: 1, outputTextTokens: 0 }, cost: { usd: 0.2, basis: 'ESTIMATED', detail: 'test' }, ms: 5, requestId: null });

/** The provider: keeps a copy of the request (a Blob) and the mask PNG (as OpenAI's provider encodes it) until it answers. */
function provider(reply) {
  const calls = [];
  return {
    calls,
    edit: ({ image, mask, size }) => {
      const blob = Buffer.from(image.bytes);
      const maskPng = encodePng(openAiMaskRgba(mask), mask.width, mask.height);
      calls.push({ size, maskBytes: maskPng.length, imageBytes: blob.length });
      return new Promise((resolve) => setTimeout(() => { void blob; void maskPng; resolve(reply()); }, 10));
    },
  };
}

function io({ answerFile = FILES.same, image = FILES.image, ids = FILES.ids, reply = null, probe = undefined } = {}) {
  const p = provider(reply ?? (() => ok(new Uint8Array(fs.readFileSync(answerFile)))));
  return {
    p,
    io: {
      readImage: async () => (image ? new Uint8Array(fs.readFileSync(image)) : null),
      readIds: async () => (ids ? new Uint8Array(fs.readFileSync(ids)) : null),
      decode, rgba, encodePng, edit: p.edit, probe,
    },
  };
}

/** The v19 handler's sequence, step for step (nothing released until the end). */
async function legacyEdit(io, color) {
  const probe = io.probe ?? (() => {});
  const [imgBytes, idBytes] = await Promise.all([io.readImage(), io.readIds()]);
  probe('read');
  const img = imgBytes ? io.decode(imgBytes) : null; const ids = idBytes ? io.decode(idBytes) : null;
  probe('decoded');
  if (!img?.ok || !ids?.ok) return { ok: false, code: 'PICTURE_UNREADABLE' };
  const raw = maskFromIds(ids.img, color, 2);
  if (!raw.pixels) return { ok: false, code: 'TARGET_NOT_VISIBLE' };
  const mask = raw.width === img.img.width && raw.height === img.img.height ? raw : { width: img.img.width, height: img.img.height, data: resizeMask(raw, img.img.width, img.img.height) };
  probe('mask');
  const png = io.encodePng(io.rgba(img.img), img.img.width, img.img.height);
  const pending = io.edit({ image: { bytes: png, mime: 'image/png' }, mask, size: { width: img.img.width, height: img.img.height } });
  probe('requested');
  const result = await pending;
  probe('answered');
  const out = io.decode(result.bytes);
  probe('result');
  const check = checkEdit(rgbToGray(img.img), rgbToGray(out.img), mask);
  probe('checked');
  const merged = compositeInsideMask(img.img, out.img, mask);
  probe('composited');
  const final = io.encodePng(io.rgba(merged), merged.width, merged.height);
  probe('encoded');
  // Everything above was still referenced here in v19 (the handler used them after this point).
  void [imgBytes, idBytes, img, ids, raw, png, result, out, merged];
  return { ok: true, png: final, check };
}

async function measured(run, options) {
  gc(); gc();
  const base = process.memoryUsage().arrayBuffers;
  const stages = {};
  const probe = (stage) => { gc(); gc(); stages[stage] = Math.round((process.memoryUsage().arrayBuffers - base) / MB * 10) / 10; };
  const { io: x, p } = io({ ...options, probe });
  const out = await run(x, SOFA);
  const peak = Math.max(...Object.values(stages));
  return { out, stages, peak, calls: p.calls };
}

test('2400×1504 edit: the shipped pipeline holds far less image memory than v19 did, and makes the same picture', async (t) => {
  const legacy = await measured(legacyEdit);
  const now = await measured(editPixels);
  t.diagnostic(`v19 sequence MB by stage: ${JSON.stringify(legacy.stages)} peak ${legacy.peak}`);
  t.diagnostic(`shipped pipeline MB by stage: ${JSON.stringify(now.stages)} peak ${now.peak}`);
  assert.equal(now.out.ok, true);
  assert.equal(legacy.out.ok, true);
  assert.ok(Buffer.from(now.out.png).equals(Buffer.from(legacy.out.png)), 'the final picture is byte for byte the v19 one');
  assert.ok(now.peak <= 60, `peak tracked image memory ${now.peak} MB (target ≤ 60)`);
  assert.ok(now.peak <= legacy.peak * 0.65, `materially lower than v19 (${now.peak} vs ${legacy.peak} MB)`);
  // Once the answer is decoded the pipeline owns the picture, the decoded answer and the mask — nothing more.
  const frame = (W * H * 4) / MB; const maskMb = (W * H) / MB;
  assert.ok(now.stages.result <= 2 * frame + maskMb + 1, `at the answer: ${now.stages.result} MB (picture + answer + mask = ${(2 * frame + maskMb).toFixed(1)})`);
  assert.ok(now.stages.encoded <= frame + maskMb + 10, `at the end: the picture, the mask and the final PNG (${now.stages.encoded} MB)`);
  assert.equal(now.calls.length, 1, 'one provider request');
  assert.deepEqual(now.calls[0].size, { width: W, height: H }, 'the full-resolution request (no downscale)');
});

test('2400×1504 edit, answer at another size: composited by sampling, no resized copy, same picture as v19', async (t) => {
  const legacy = await measured(legacyEdit, { answerFile: FILES.small });
  const now = await measured(editPixels, { answerFile: FILES.small });
  t.diagnostic(`v19 peak ${legacy.peak} MB, shipped ${now.peak} MB (answer 1600×1003)`);
  assert.equal(now.out.ok, true, JSON.stringify(now.out.check ?? now.out));
  assert.ok(Buffer.from(now.out.png).equals(Buffer.from(legacy.out.png)), 'byte for byte the v19 picture');
  assert.ok(now.peak <= 60 && now.peak <= legacy.peak * 0.65, `${now.peak} vs ${legacy.peak} MB`);
});

test('mask boundaries: inside the target (and its 2 px seam) the answer, everywhere else the original exactly', async () => {
  const { io: x } = io();
  const out = await editPixels(x, SOFA);
  assert.equal(out.ok, true);
  const final = decode(out.png).img; const original = picture(); const ans = answer(original);
  const px = (img, xx, yy) => [...img.data.subarray((yy * W + xx) * 4, (yy * W + xx) * 4 + 3)];
  assert.deepEqual(px(final, 1300, 700), px(ans, 1300, 700), 'inside: repainted');
  assert.deepEqual(px(final, sofa.x0 - 2, 700), px(ans, sofa.x0 - 2, 700), 'the 2 px seam: repainted');
  assert.deepEqual(px(final, sofa.x0 - 3, 700), px(original, sofa.x0 - 3, 700), '3 px out: the original, not the drifted answer');
  assert.deepEqual(px(final, 1600, 700), px(original, 1600, 700), 'the touching table keeps its pixels');
  assert.deepEqual(px(final, 10, 10), px(original, 10, 10), 'far away: the original');
  let changed = 0;
  for (let i = 0; i < W * H; i += 1) if (final.data[i * 4] !== original.data[i * 4]) changed += 1;
  const mask = maskFromIds(idPicture(), SOFA, 2);
  assert.ok(changed <= mask.pixels, `only masked pixels change (${changed} ≤ ${mask.pixels})`);
});

test('compositeInsideMaskInto gives compositeInsideMask\'s pixels for every size and channel combination', () => {
  let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
  const img = (w, h, ch) => ({ width: w, height: h, channels: ch, data: Uint8Array.from({ length: w * h * ch }, rnd) });
  for (const [ow, oh, ew, eh, och, ech, mw, mh] of [
    [40, 25, 40, 25, 4, 4, 40, 25], [40, 25, 27, 17, 4, 4, 40, 25], [40, 25, 64, 40, 3, 4, 40, 25],
    [40, 25, 40, 25, 4, 3, 20, 13], [31, 19, 50, 33, 3, 3, 31, 19],
  ]) {
    const original = img(ow, oh, och); const edited = img(ew, eh, ech);
    const mask = { width: mw, height: mh, data: Uint8Array.from({ length: mw * mh }, () => rnd() & 1) };
    const expected = compositeInsideMask(original, edited, mask);
    const dest = { ...original, data: new Uint8Array(original.data) };
    const got = compositeInsideMaskInto(dest, edited, mask);
    assert.equal(got, dest, 'written into the destination');
    assert.deepEqual([...got.data], [...expected.data], `${ow}x${oh}/${ew}x${eh} ch ${och}/${ech} mask ${mw}x${mh}`);
  }
});

test('failures carry the handler\'s codes, in its order, and nothing is asked of the provider before it must be', async () => {
  let r = await editPixels(io({ image: null }).io, SOFA);
  assert.deepEqual([r.ok, r.code, r.status], [false, 'PICTURE_UNREADABLE', 422]);
  const absent = io();
  r = await editPixels(absent.io, '#abcdef');
  assert.deepEqual([r.ok, r.code, r.status], [false, 'TARGET_NOT_VISIBLE', 422]);
  assert.equal(absent.p.calls.length, 0, 'no paid request for a target that is not in the picture');
  r = await editPixels(io({ reply: () => ({ ok: false, provider: 'OPENAI', model: 'gpt-image-2', error: 'PROVIDER_REFUSED_400', status: 400, ms: 3, cost: { usd: null, basis: 'UNPRICED', detail: 'x' } }) }).io, SOFA);
  assert.deepEqual([r.ok, r.code, r.status, r.finishReason], [false, 'PROVIDER_REFUSED_400', 502, 'PROVIDER_REFUSED_400']);
  assert.equal(r.result.error, 'PROVIDER_REFUSED_400', 'the answer travels for the record and the money');
  r = await editPixels(io({ reply: () => ok(new Uint8Array([0x89, 0x50, 1, 2, 3])) }).io, SOFA);
  assert.deepEqual([r.ok, r.code, r.finishReason], [false, 'EDIT_DECODE_FAILED', 'EDIT_DECODE_FAILED']);
  assert.equal('bytes' in r.result, false, 'the answer bytes are not kept in the outcome');
  // A model that re-lit the whole frame is refused (the outside changed).
  const relit = answer(picture()); for (let i = 0; i < relit.data.length; i += 4) for (let k = 0; k < 3; k += 1) relit.data[i + k] = Math.max(0, relit.data[i + k] - 40);
  const sf = path.join(DIR, 'relit.png'); fs.writeFileSync(sf, encodePng(relit.data, W, H));
  r = await editPixels(io({ answerFile: sf }).io, SOFA);
  assert.deepEqual([r.ok, r.code, r.status], [false, 'EDIT_REFUSED', 422]);
  assert.equal(r.check.accepted, false);
});

test('a dead edit is recovered within ~75 s of its last heartbeat; a slow, living one is left alone', () => {
  const t0 = Date.parse('2026-10-02T14:02:44.747Z');
  const row = (over) => ({ kind: 'EDIT', status: 'FINISHING', lease_at: new Date(t0).toISOString(), timings: { requestedAt: new Date(t0).toISOString() }, ...over });
  const beat = (ms) => ({ timings: { heartbeatAt: new Date(t0 + ms).toISOString() } });
  assert.equal(editRecovery(row(), t0 + 30_000), null, 'just started');
  assert.equal(editRecovery(row(), t0 + EDIT_SILENT_MS + 1), 'EDIT_INTERRUPTED', 'never beat (the v19 row, or a worker killed at once)');
  assert.equal(editRecovery(row(beat(90_000)), t0 + 95_000), null, 'beating while the provider is waited for');
  assert.equal(editRecovery(row(beat(4 * 60_000)), t0 + 4 * 60_000 + 5_000), null, 'a slow provider (4 min) with a living worker');
  assert.equal(editRecovery(row(beat(90_000)), t0 + 90_000 + EDIT_SILENT_MS + 1), 'EDIT_INTERRUPTED', 'killed after its last beat');
  assert.equal(editRecovery(row(beat(EDIT_LEASE_MS)), t0 + EDIT_LEASE_MS + 1), 'EDIT_TIMEOUT', 'the hard ceiling holds even while beating');
  assert.equal(editRecovery(row({ status: 'READY' }), t0 + EDIT_LEASE_MS * 2), null);
  assert.equal(editRecovery(row({ status: 'FAILED' }), t0 + EDIT_LEASE_MS * 2), null);
  assert.equal(editRecovery(row({ kind: 'MASTER' }), t0 + EDIT_LEASE_MS * 2), null, 'renders have their own lease');
  assert.equal(editRecovery(row({ lease_at: null }), t0 + EDIT_LEASE_MS * 2), null);
  assert.equal(editRecovery(row(beat(-5_000)), t0 + EDIT_SILENT_MS - 1), null, 'a beat older than the lease does not shorten it');
});

test('the edit handler: caught failures and dead workers end FAILED once, money released once, never settled after', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-reconstruct/renders.ts'), 'utf8');
  const editFn = src.slice(src.indexOf('export async function handleRenderEdit'));
  // Every pipeline failure and any throw go through failRender (compare-and-set on FINISHING, then release).
  assert.match(editFn, /if \(!o\.ok\) \{[\s\S]*?return fail\(o\.code, o\.status/);
  assert.match(editFn, /catch \(e\) \{[\s\S]*?await fail\(`EDIT_CRASHED:/);
  assert.match(editFn, /finally \{\s*clearInterval\(timer\);/);
  // The heartbeat and READY only touch this lease's FINISHING row.
  assert.match(editFn, /heartbeatAt: new Date\(\)\.toISOString\(\) \} \}\)\s*\.eq\('id', row\.id\)\.eq\('status', 'FINISHING'\)\.eq\('lease_at', lease\)/);
  assert.match(editFn, /status: 'READY'[\s\S]*?\.eq\('id', row\.id\)\.eq\('status', 'FINISHING'\)\.eq\('lease_at', lease\)/);
  // The poll recovers dead edits through the same compare-and-set.
  const status = src.slice(src.indexOf('export async function handleRenderStatus'), src.indexOf('export async function handleRenderStatus') + 1800);
  assert.match(status, /const lapse = editRecovery\(row, nowMs\);[\s\S]*?failRender\(ctx\.admin, row, lapse, null, [^;]*\['FINISHING'\]\)/);
  // failRender releases only after it won the claim; READY settles only after it won its own.
  const fr = src.slice(src.indexOf('async function failRender'), src.indexOf('async function failRender') + 900);
  assert.ok(fr.indexOf("if (!claimed?.length) return;") < fr.indexOf("closeBilling("), 'release only by the claim winner');
  assert.match(editFn, /if \(done\?\.length\) \{\s*const billing = await closeBilling\(ctx\.admin, done\[0\], 'SETTLE'/);
});
