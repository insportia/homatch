// tasFile.test.mjs — the secure document viewer's worker hop (verify/TasFileRoute.ts).
// Proven: token-only, one numeric id, only real files leave (an HTML "Access
// Denied" page is refused), bytes bounded, one shared polite lane, and two
// requests for the same file share one download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createTasFileFetcher, mountTasFileRoutes, sniffFile } from '../.tstest-build/verify/TasFileRoute.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const DENIED = new TextEncoder().encode('<html><head><title>Access Denied</title></head><body>Access Denied</body></html>');

const fakeFetch = (body, { status = 200, type = 'application/octet-stream', calls } = {}) => async (url) => {
  calls?.push(String(url));
  return new Response(body, { status, headers: { 'content-type': type, 'content-length': String(body.length) } });
};

test('bytes are sniffed: pdf, png, jpg, and an HTML page is never a file', () => {
  assert.equal(sniffFile(PDF, 'application/octet-stream'), 'pdf');
  assert.equal(sniffFile(PNG, null), 'png');
  assert.equal(sniffFile(JPG, null), 'jpg');
  assert.equal(sniffFile(DENIED, 'application/pdf'), 'html', 'an Access Denied page posing as a pdf');
  assert.equal(sniffFile(new Uint8Array([1, 2, 3]), 'text/html'), 'html');
});

test('one numeric id only, and the exact DownloadServlet attachment URL', async () => {
  const calls = [];
  const get = createTasFileFetcher({ fetcher: fakeFetch(PDF, { calls }), minGapMs: 0 });
  for (const bad of ['', 'abc', '12a', '../1', '1'.repeat(13)]) {
    const r = await get(bad);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  }
  const r = await get('5418975');
  assert.equal(r.ok, true);
  assert.equal(r.mime, 'application/pdf');
  assert.deepEqual(calls, ['https://docs.tbilisi.gov.ge/DownloadServlet?downloadCase=2&attachedFileId=5418975']);
});

test('an Access Denied page and an upstream error are refused, never streamed', async () => {
  const denied = await createTasFileFetcher({ fetcher: fakeFetch(DENIED, { type: 'text/html' }), minGapMs: 0 })('1');
  assert.deepEqual([denied.ok, denied.status, denied.error], [false, 502, 'not_a_file']);
  const down = await createTasFileFetcher({ fetcher: fakeFetch(PDF, { status: 403 }), minGapMs: 0 })('1');
  assert.deepEqual([down.ok, down.error], [false, 'upstream']);
});

test('bytes are bounded', async () => {
  const big = new Uint8Array(2048);
  big.set(PDF);
  const r = await createTasFileFetcher({ fetcher: fakeFetch(big), minGapMs: 0, maxBytes: 1024 })('7');
  assert.deepEqual([r.ok, r.status, r.error], [false, 413, 'too_large']);
});

test('the same file requested twice is downloaded once; different files are spaced politely', async () => {
  const calls = [];
  const get = createTasFileFetcher({ fetcher: fakeFetch(PDF, { calls }), minGapMs: 60 });
  const [a, b] = await Promise.all([get('11'), get('11')]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(calls.length, 1, 'two clicks, two downloads');
  const t0 = Date.now();
  await Promise.all([get('12'), get('13')]);
  assert.ok(Date.now() - t0 >= 55, 'two TAS downloads were not spaced');
  assert.equal(calls.length, 3);
});

test('the route is token-only and streams the sniffed type', async () => {
  const app = express();
  app.use(express.json());
  mountTasFileRoutes(app, { token: 'secret', fetcher: fakeFetch(PDF), minGapMs: 0 });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const anon = await fetch(`${base}/verify/tas-file?attachedFileId=1`, { headers: { authorization: 'Bearer user-jwt', apikey: 'anon' } });
    assert.equal(anon.status, 401, 'a user session reached the TAS fetcher');
    const ok = await fetch(`${base}/verify/tas-file?attachedFileId=1`, { headers: { authorization: 'Bearer secret' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/pdf');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), PDF);
    const post = await fetch(`${base}/verify/tas-file`, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ attachedFileId: 'x' }) });
    assert.equal(post.status, 400);
  } finally {
    server.close();
  }
});
