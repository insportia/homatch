// tasFileRecovery.test.mjs — the targeted re-fetch of skipped TAS pictures
// (POST /verify/tas-files) and the older-case budget exemption for native
// images (2026-10-11, job 8ba97da9: 24 .jpg attachments, among them 1.jpg /
// 2.jpg / 3.jpg of case 1084312, were accounted NOT_PROCESSED_BUDGET and
// never opened).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasFileRequest, recoverTasFiles, TAS_FILE_RECOVERY_MAX } from '../.tstest-build/workflows/tas/api/tasFileRecovery.js';
import { acquireTasApi, __resetTasApiCaches, getCachedVisual, isBudgetExemptImage } from '../.tstest-build/workflows/tas/api/TasApiWorkflow.js';
import { FULL, fakeJpeg, fixtureFetcher, fixturePdfParser } from './fixtures/tas/tasFixture.mjs';
import { readFileSync } from 'node:fs';

test('the request is validated, de-duplicated and bounded', () => {
  assert.equal(parseTasFileRequest({}), null);
  assert.equal(parseTasFileRequest({ attachedFileIds: ['abc', '../x', ''] }), null);
  const ids = Array.from({ length: 60 }, (_, i) => String(4850000 + i));
  const p = parseTasFileRequest({ attachedFileIds: ['4850052', '4850052', ...ids], parcel: '01.18.06.019.055' });
  assert.equal(p.files.length, TAS_FILE_RECOVERY_MAX);
  assert.equal(p.files[0].attachedFileId, '4850052');
  assert.equal(new Set(p.files.map((f) => f.attachedFileId)).size, p.files.length);
  assert.equal(p.parcel, '01.18.06.019.055');
  const rich = parseTasFileRequest({ files: [{ attachedFileId: 4850053, documentId: '1084312', fileName: '2.jpg', context: 'x'.repeat(900) }] });
  assert.equal(rich.files[0].attachedFileId, '4850053');
  assert.equal(rich.files[0].context.length, 400);
});

test('only the named attachments are fetched, politely, and land in the visual cache', async () => {
  __resetTasApiCaches();
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  const fetcher = async (url) => {
    const u = new URL(String(url));
    calls.push(u.pathname + u.search);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    const id = u.searchParams.get('attachedFileId');
    if (u.pathname !== '/DownloadServlet') return new Response('no', { status: 404 });
    if (id === '4850054') return new Response('gone', { status: 404 });
    if (id === '4850060') return new Response(fakeJpeg(200, 120, 1), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response(fakeJpeg(2400, 1350, Number(id)), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const out = await recoverTasFiles([
    { attachedFileId: '4850052', documentId: '1084312', fileName: '1.jpg', caseCadastralCodes: ['01.18.06.019.055'] },
    { attachedFileId: '4850053', documentId: '1084312', fileName: 'რენდერი 2.jpg' },
    { attachedFileId: '4850054', documentId: '1084312', fileName: '3.jpg' },
    { attachedFileId: '4850060', documentId: '1084312', fileName: 'icon.jpg' },
    { attachedFileId: '4850070', documentId: '1084312', fileName: 'ამონაწერი.jpg' },
  ], { fetcher, minGapMs: 0, parcel: '01.18.06.019.055' });

  assert.ok(calls.every((c) => c.startsWith('/DownloadServlet?downloadCase=2&attachedFileId=')), 'something other than the named files was requested');
  assert.ok(!calls.some((c) => c.includes('4850070')), 'paperwork was downloaded');
  assert.ok(peak <= 2, `concurrency ${peak} > 2`);
  const by = Object.fromEntries(out.files.map((f) => [f.attachedFileId, f.outcome]));
  assert.deepEqual(by, { 4850052: 'RECOVERED', 4850053: 'RECOVERED', 4850054: 'DOWNLOAD_FAILED', 4850060: 'NO_VISUAL', 4850070: 'PAPERWORK' });
  assert.equal(out.visuals.length, 2);
  for (const v of out.visuals) {
    assert.match(v.id, /^[a-f0-9]{64}$/);
    assert.ok(getCachedVisual(v.id), 'not served by GET /research/visual/:sha');
    assert.equal(v.source, 'TAS');
    assert.equal(v.documentId, '1084312');
    assert.equal(v.extraction, 'NATIVE_IMAGE');
    assert.equal(v.width, 2400);
    assert.equal(v.date, null, 'a date was invented');
  }
  assert.equal(out.visuals.find((v) => v.attachedFileId === '4850053').kind, 'RENDER', 'the shared classifier was not applied');
  assert.equal(out.visuals.find((v) => v.attachedFileId === '4850052').kind, 'OTHER', 'an unlabelled image was upgraded');
});

test('a deadline is reported per file, never thrown', async () => {
  const fetcher = async () => new Response(fakeJpeg(2000, 1200, 3), { status: 200 });
  let t = 0;
  const out = await recoverTasFiles([{ attachedFileId: '1', fileName: '1.jpg' }], { fetcher, minGapMs: 0, budgetMs: 1000, now: () => (t += 5000) });
  assert.equal(out.files[0].outcome, 'DEADLINE');
  assert.equal(out.deadlineReached, true);
});

test('older-case budget: native images are exempt, PDFs are not', async () => {
  assert.equal(isBudgetExemptImage('jpg', 3_000_000), true);
  assert.equal(isBudgetExemptImage('png', null), true);
  assert.equal(isBudgetExemptImage('jpg', 40_000_000), false, 'a huge image is still bounded');
  assert.equal(isBudgetExemptImage('pdf', 100), false);
  __resetTasApiCaches();
  const { fetcher } = fixtureFetcher();
  const raw = await acquireTasApi(FULL, { fetcher, parsePdf: fixturePdfParser, pageSize: 10, minGapMs: 0, concurrency: 4, olderCasesBudgetMs: 0 });
  const older = raw.cases.filter((c) => !c.priority).flatMap((c) => c.attachments);
  const jpg = older.filter((a) => a.format === 'jpg' || a.format === 'jpeg' || /\.jpg$/i.test(a.fileName ?? ''));
  assert.ok(jpg.length > 0, 'fixture has older-case images');
  assert.equal(jpg.filter((a) => a.outcome === 'NOT_PROCESSED_BUDGET').length, 0, 'an image was skipped by the older-case budget');
  assert.ok(older.some((a) => a.outcome === 'NOT_PROCESSED_BUDGET'), 'the budget no longer applies to anything');
});

test('the endpoint is mounted behind the worker auth', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /app\.post\('\/verify\/tas-files', auth, /);
  assert.match(src, /recoverTasFiles\(parsed\.files/);
});
