// The object edit's pixels at production size (2400×1504) with real PNG bytes:
// what each step holds, what each step decodes and encodes, and that the two
// steps make exactly the picture the single-step edit made.
//
// Production: the single-step edit was killed by the edge runtime for memory
// (v19, render 5ca68781: 113 MB, 99 MB image buffers, 1964 ms CPU) and, once
// memory was fixed, for CPU time (v20, render 5185d6ed: 2433 ms). Measured with
// the edge's own codec (fast-png 6.2.0), CPU is dominated by full-size PNG
// decodes (~0.1–0.25 s each) and encodes (~0.45 s each); so besides memory, each
// step's decode/encode work is counted here through the injected codec.
//
// legacyEdit below is the v19 sequence step for step, the reference for "the
// same picture". A probe collects garbage and reads arrayBuffers: what is still
// reachable at that stage. Codec-internal transients are not sampled.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { editFinishPixels, editRequestPixels, reusablePng } from '../editPipeline.ts';
import { checkEdit, compositeInsideMask, compositeInsideMaskInto, maskFromIds, resizeMask, rgbToGray } from '../renderCheck.ts';
import { openAiMaskRgba } from '../imageProviders.ts';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const MB = 1024 * 1024;

// ── A real PNG codec (8-bit RGB/RGBA, filter 0), standing in for fast-png ──

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function pngOf(pixels, width, height, channels) {
  const row = width * channels;
  const raw = Buffer.alloc(height * (row + 1));
  for (let y = 0; y < height; y += 1) Buffer.from(pixels.buffer, pixels.byteOffset + y * row, row).copy(raw, y * (row + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
}
const counts = { decodes: 0, fullDecodes: 0, encodes: 0 };
const resetCounts = () => { counts.decodes = 0; counts.fullDecodes = 0; counts.encodes = 0; };
function encodePng(rgba, width, height) { counts.encodes += 1; return pngOf(rgba, width, height, 4); }
/** Test stand-in for a JPEG (not a PNG, so never reusable): 0xFFD8, width, height, raw RGBA. */
function fakeJpeg(rgba, width, height) {
  const h = Buffer.alloc(10); h[0] = 0xff; h[1] = 0xd8; h.writeUInt32BE(width, 2); h.writeUInt32BE(height, 6);
  return new Uint8Array(Buffer.concat([h, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length)]));
}
function decode(bytes) {
  counts.decodes += 1;
  try {
    const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
    if (b[0] === 0xff && b[1] === 0xd8) {
      const width = b.readUInt32BE(2); const height = b.readUInt32BE(6);
      if (width * height >= 1_000_000) counts.fullDecodes += 1;
      return { ok: true, img: { width, height, data: new Uint8Array(b.subarray(10, 10 + width * height * 4)), channels: 4 } };
    }
    if (b[0] !== 0x89 || b[1] !== 0x50) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
    let p = 8; let width = 0; let height = 0; let ch = 4; const idat = [];
    while (p < b.length) {
      const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8);
      if (type === 'IHDR') { width = b.readUInt32BE(p + 8); height = b.readUInt32BE(p + 12); ch = b[p + 17] === 2 ? 3 : 4; }
      if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
      p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const data = new Uint8Array(width * height * 4); const row = width * ch;
    for (let y = 0; y < height; y += 1) {
      if (raw[y * (row + 1)] !== 0) return { ok: false, reason: 'DECODE_FAILED' };
      for (let x = 0; x < width; x += 1) {
        const s = y * (row + 1) + 1 + x * ch; const d = (y * width + x) * 4;
        data[d] = raw[s]; data[d + 1] = raw[s + 1]; data[d + 2] = raw[s + 2]; data[d + 3] = ch === 4 ? raw[s + 3] : 255;
      }
    }
    if (width * height >= 1_000_000) counts.fullDecodes += 1;
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
const rgbOf = (img) => { const o = new Uint8Array(img.width * img.height * 3); for (let i = 0; i < img.width * img.height; i += 1) { o[i * 3] = img.data[i * 4]; o[i * 3 + 1] = img.data[i * 4 + 1]; o[i * 3 + 2] = img.data[i * 4 + 2]; } return o; };

// Fixtures live on disk: every read is a fresh buffer the test itself does not hold.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-edit-'));
const FILES = (() => {
  const pic = picture(); const ids = idPicture(); const ans = answer(pic);
  const f = {
    image: path.join(DIR, 'master.png'), jpeg: path.join(DIR, 'master.jpg'), ids: path.join(DIR, 'ids.png'),
    same: path.join(DIR, 'answer.png'), small: path.join(DIR, 'answer-1600.png'),
  };
  // The stored master is OpenAI's own answer: an 8-bit RGB PNG.
  fs.writeFileSync(f.image, pngOf(rgbOf(pic), W, H, 3));
  fs.writeFileSync(f.jpeg, fakeJpeg(pic.data, W, H));
  fs.writeFileSync(f.ids, pngOf(ids.data, W, H, 4));
  fs.writeFileSync(f.same, pngOf(rgbOf(ans), W, H, 3));
  const small = nearest(ans, 1600, 1003);
  fs.writeFileSync(f.small, pngOf(rgbOf(small), small.width, small.height, 3));
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
      const maskPng = pngOf(openAiMaskRgba(mask), mask.width, mask.height, 4); // inside the provider: not the pipeline's codec
      calls.push({ size, image: blob, maskPixels: mask.data.reduce((s, v) => s + v, 0) });
      return new Promise((resolve) => setTimeout(() => { void maskPng; resolve(reply()); }, 10));
    },
  };
}
const read = (file) => async () => (file ? new Uint8Array(fs.readFileSync(file)) : null);

function requestIo({ image = FILES.image, ids = FILES.ids, answerFile = FILES.same, reply = null, probe = undefined } = {}) {
  const p = provider(reply ?? (() => ok(new Uint8Array(fs.readFileSync(answerFile)))));
  return { p, io: { readImage: read(image), readIds: read(ids), decode, rgba, encodePng, edit: p.edit, probe } };
}
function finishIo({ image = FILES.image, ids = FILES.ids, answerFile = FILES.same, probe = undefined } = {}) {
  return { readImage: read(image), readIds: read(ids), readAnswer: read(answerFile), decode, rgba, encodePng, probe };
}

/** The v19 handler's single-step sequence (the reference picture). */
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
  void [imgBytes, idBytes, img, ids, raw, png, result, out, merged];
  return { ok: true, png: final, check };
}

function prober() {
  gc(); gc();
  const base = process.memoryUsage().arrayBuffers;
  const stages = {};
  const probe = (stage) => { gc(); gc(); stages[stage] = Math.round((process.memoryUsage().arrayBuffers - base) / MB * 10) / 10; };
  return { stages, probe, peak: () => Math.max(...Object.values(stages)) };
}
const frame = (W * H * 4) / MB; const maskMb = (W * H) / MB;
const fileMb = (f) => fs.statSync(f).size / MB;

test('step 1 at 2400×1504: the stored master goes to OpenAI byte for byte — no picture decoded or encoded, little held', async (t) => {
  resetCounts();
  const m = prober();
  const { io, p } = requestIo({ probe: m.probe });
  const o = await editRequestPixels(io, SOFA);
  t.diagnostic(`step 1 MB by stage: ${JSON.stringify(m.stages)} peak ${m.peak()}; decodes ${counts.decodes} (full-size ${counts.fullDecodes}), encodes ${counts.encodes}`);
  assert.equal(o.ok, true);
  assert.equal(o.reusedPicture, true);
  assert.equal(p.calls.length, 1, 'one provider request');
  assert.ok(p.calls[0].image.equals(fs.readFileSync(FILES.image)), 'the request image is the stored PNG, byte for byte');
  assert.deepEqual(p.calls[0].size, { width: W, height: H }, 'full resolution');
  assert.deepEqual([counts.fullDecodes, counts.encodes], [1, 0], 'only the id map is decoded; nothing is encoded by the pipeline');
  assert.ok(Buffer.from(o.bytes).equals(fs.readFileSync(FILES.same)), 'the answer comes back unchanged (it is staged as is)');
  // It never holds a decoded picture: at most the id map while the mask is made, the mask, the stored files.
  assert.ok(m.peak() <= frame + maskMb + 2 * fileMb(FILES.image) + 1, `step 1 peak ${m.peak()} MB`);
});

test('step 2 at 2400×1504: three decodes, one encode, the picture + answer + mask held at most', async (t) => {
  resetCounts();
  const m = prober();
  const o = await editFinishPixels(finishIo({ probe: m.probe }), SOFA);
  t.diagnostic(`step 2 MB by stage: ${JSON.stringify(m.stages)} peak ${m.peak()}; decodes ${counts.decodes} (full-size ${counts.fullDecodes}), encodes ${counts.encodes}`);
  assert.equal(o.ok, true, JSON.stringify(o.check ?? o));
  assert.deepEqual([counts.fullDecodes, counts.encodes], [3, 1], 'picture, id map and answer decoded; the final PNG encoded once');
  assert.ok(m.stages.result <= 2 * frame + maskMb + 1, `once the answer is decoded: ${m.stages.result} MB (picture + answer + mask = ${(2 * frame + maskMb).toFixed(1)})`);
  assert.ok(m.peak() <= 2 * frame + 2 * maskMb + 1, `step 2 peak ${m.peak()} MB`);
});

test('the two steps make exactly the v19 single-step picture — same size and another size answer — at less than half the memory', async (t) => {
  for (const answerFile of [FILES.same, FILES.small]) {
    const lm = prober();
    const { io: lio } = requestIo({ answerFile, probe: lm.probe });
    const legacy = await legacyEdit(lio, SOFA);
    const r = await editRequestPixels(requestIo({ answerFile }).io, SOFA);
    const staged = path.join(DIR, 'staged.png'); fs.writeFileSync(staged, r.bytes);
    const fm = prober();
    const two = await editFinishPixels(finishIo({ answerFile: staged, probe: fm.probe }), SOFA, r.answer);
    t.diagnostic(`${path.basename(answerFile)}: v19 peak ${lm.peak()} MB, two-step finish peak ${fm.peak()} MB`);
    assert.equal(legacy.ok, true); assert.equal(two.ok, true);
    assert.ok(Buffer.from(two.png).equals(Buffer.from(legacy.png)), 'byte for byte the v19 picture');
    assert.deepEqual(two.check, legacy.check, 'the same check, the same numbers');
    assert.ok(fm.peak() <= lm.peak() * 0.65, `${fm.peak()} vs ${lm.peak()} MB`);
  }
});

test('a picture that is not a reusable PNG (JPEG) is decoded and encoded once in step 1, as before', async () => {
  resetCounts();
  const { io, p } = requestIo({ image: FILES.jpeg });
  const o = await editRequestPixels(io, SOFA);
  assert.equal(o.ok, true);
  assert.equal(o.reusedPicture, false);
  assert.deepEqual([counts.fullDecodes, counts.encodes], [2, 1], 'picture and id map decoded, the request PNG encoded');
  const sent = decode(new Uint8Array(p.calls[0].image));
  assert.deepEqual([...sent.img.data.subarray(0, 4000)], [...picture().data.subarray(0, 4000)], 'the same pixels go to the provider');
});

test('reusablePng: only 8-bit RGB/RGBA, non-interlaced PNGs go as stored', () => {
  const png = fs.readFileSync(FILES.image);
  assert.deepEqual(reusablePng(png), { width: W, height: H });
  const tweak = (i, v) => { const b = Buffer.from(png.subarray(0, 64)); b[i] = v; return b; };
  assert.equal(reusablePng(tweak(24, 16)), null, '16-bit');
  assert.equal(reusablePng(tweak(25, 3)), null, 'palette');
  assert.equal(reusablePng(tweak(25, 0)), null, 'grey');
  assert.equal(reusablePng(tweak(28, 1)), null, 'interlaced');
  assert.equal(reusablePng(tweak(1, 0)), null, 'not a PNG');
  assert.equal(reusablePng(fs.readFileSync(FILES.jpeg).subarray(0, 64)), null, 'JPEG');
});

test('mask boundaries: inside the target (and its 2 px seam) the answer, everywhere else the original exactly', async () => {
  const o = await editFinishPixels(finishIo(), SOFA);
  assert.equal(o.ok, true);
  const final = decode(o.png).img; const original = picture(); const ans = answer(original);
  const px = (img, xx, yy) => [...img.data.subarray((yy * W + xx) * 4, (yy * W + xx) * 4 + 3)];
  assert.deepEqual(px(final, 1300, 700), px(ans, 1300, 700), 'inside: repainted');
  assert.deepEqual(px(final, sofa.x0 - 2, 700), px(ans, sofa.x0 - 2, 700), 'the 2 px seam: repainted');
  assert.deepEqual(px(final, sofa.x0 - 3, 700), px(original, sofa.x0 - 3, 700), '3 px out: the original, not the drifted answer');
  assert.deepEqual(px(final, 1600, 700), px(original, 1600, 700), 'the touching table keeps its pixels');
  assert.deepEqual(px(final, 10, 10), px(original, 10, 10), 'far away: the original');
  let changed = 0;
  for (let i = 0; i < W * H; i += 1) if (final.data[i * 4] !== original.data[i * 4]) changed += 1;
  assert.ok(changed <= maskFromIds(idPicture(), SOFA, 2).pixels, 'only masked pixels change');
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

test('failures carry the handler\'s codes, and no paid request is made that need not be', async () => {
  let r = await editRequestPixels(requestIo({ image: null }).io, SOFA);
  assert.deepEqual([r.ok, r.code, r.status], [false, 'PICTURE_UNREADABLE', 422]);
  const absent = requestIo();
  r = await editRequestPixels(absent.io, '#abcdef');
  assert.deepEqual([r.ok, r.code, r.status], [false, 'TARGET_NOT_VISIBLE', 422]);
  assert.equal(absent.p.calls.length, 0, 'no paid request for a target that is not in the picture');
  r = await editRequestPixels(requestIo({ reply: () => ({ ok: false, provider: 'OPENAI', model: 'gpt-image-2', error: 'PROVIDER_REFUSED_400', status: 400, ms: 3, cost: { usd: null, basis: 'UNPRICED', detail: 'x' } }) }).io, SOFA);
  assert.deepEqual([r.ok, r.code, r.status, r.finishReason], [false, 'PROVIDER_REFUSED_400', 502, 'PROVIDER_REFUSED_400']);
  assert.equal(r.result.error, 'PROVIDER_REFUSED_400', 'the answer travels for the record and the money');
  // Step 2.
  const bad = path.join(DIR, 'bad.png'); fs.writeFileSync(bad, new Uint8Array([0x89, 0x50, 1, 2, 3]));
  r = await editFinishPixels(finishIo({ answerFile: bad }), SOFA);
  assert.deepEqual([r.ok, r.code, r.finishReason], [false, 'EDIT_DECODE_FAILED', 'EDIT_DECODE_FAILED']);
  r = await editFinishPixels(finishIo({ answerFile: null }), SOFA);
  assert.deepEqual([r.ok, r.code], [false, 'EDIT_STAGED_MISSING']);
  // A model that re-lit the whole frame is refused (the outside changed).
  const relit = answer(picture()); for (let i = 0; i < relit.data.length; i += 4) for (let k = 0; k < 3; k += 1) relit.data[i + k] = Math.max(0, relit.data[i + k] - 40);
  const rf = path.join(DIR, 'relit.png'); fs.writeFileSync(rf, pngOf(relit.data, W, H, 4));
  r = await editFinishPixels(finishIo({ answerFile: rf }), SOFA);
  assert.deepEqual([r.ok, r.code, r.status], [false, 'EDIT_REFUSED', 422]);
  assert.equal(r.check.accepted, false);
});
