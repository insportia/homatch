// A parcel with many NAPR records (prod 1ff4b786, 88.20.21.767.117.2): the run must keep the documents it read
// instead of timing out with nothing, and one gated or unreadable record must not void the others.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMyGovApiWorkflow } from '../.tstest-build/workflows/mygov/MyGovApiWorkflow.js';

const code = '88.20.21.767.117.2';
const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const ids = ['r1', 'r2', 'r3'];

function napr({ gated = [], onRecord = () => {}, parse } = {}) {
  const opened = [];
  const fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/search')) return json({ applist: ids.map((id) => ({ appID: id, regNumber: 'reg-' + id })), page: 1, lastpage: 1, total: ids.length });
    const id = ids.find((x) => u.endsWith('/' + x));
    if (u.includes('/api/appstatus/')) return json({ status: gated.includes(id) ? 15 : 20 });
    if (u.includes('/api/app/')) {
      opened.push(id);
      onRecord(id);
      return json({ appinfo: { r_info: [{ APP_ID: id, CADCODE: code, REG_NUMBER: 'reg-' + id }] }, edocuments: [{ DOC_NAME: 'doc-' + id, ICON: 'signed-pdf', BLOB_URI: 'https://bs.napr.gov.ge/GetBlob?pid=' + id + '&bid=b' }], statuses: [], letters: [] });
    }
    return new Response('%PDF-1.7 fixture', { headers: { 'Content-Type': 'application/pdf' } });
  };
  return { fetch, opened, parsePdf: parse ?? (async () => ({ text: 'Official extract text that is long enough to read.', numpages: 1 })) };
}

test('records are opened only while there is time for one more; the rest are listed, not lost', async () => {
  let t = 0;
  const h = napr({ onRecord: () => { t += 200_000; } });
  const result = await runMyGovApiWorkflow(code, undefined, { fetch: h.fetch, parsePdf: h.parsePdf, budgetMs: 420_000, now: () => t });
  assert.deepEqual(h.opened, ['r1', 'r2'], 'r3 would start with 20 s left: not opened');
  assert.deepEqual(result.recordsDeferredForTime, ['r3']);
  assert.equal(result.status, 'SEARCH_CONFIRMED');
  assert.equal(result.resultConfirmed, true);
  assert.equal(result.partial, true);
  assert.match(result.resultContext, /Official extract text/);
});

test('one gated record among many keeps the documents the other records yielded', async () => {
  const h = napr({ gated: ['r2'] });
  const result = await runMyGovApiWorkflow(code, undefined, { fetch: h.fetch, parsePdf: h.parsePdf });
  assert.equal(result.status, 'SEARCH_CONFIRMED');
  assert.equal(result.resultConfirmed, true);
  assert.equal(result.documents.filter((d) => d.complete).length, 2);
  assert.deepEqual(result.traversal.continuations.map((c) => c.recordId), ['r2']);
  assert.equal(result.blocked, false);
  assert.equal(result.partial, true);
  assert.equal(result.error, null);
});

test('a hard deadline keeps the documents already read instead of returning TIMEOUT', async () => {
  let n = 0;
  const h = napr({ parse: async () => (++n === 1 ? { text: 'First official extract, fully read before the deadline.', numpages: 1 } : new Promise(() => {})) });
  const result = await runMyGovApiWorkflow(code, undefined, { fetch: h.fetch, parsePdf: h.parsePdf, budgetMs: 80, recordReserveMs: 0 });
  assert.equal(result.status, 'SEARCH_CONFIRMED');
  assert.equal(result.truncatedByDeadline, true);
  assert.match(result.resultContext, /First official extract/);
});

test('nothing read at the deadline is still a TIMEOUT', async () => {
  const h = napr({ parse: () => new Promise(() => {}) });
  const result = await runMyGovApiWorkflow(code, undefined, { fetch: h.fetch, parsePdf: h.parsePdf, budgetMs: 40, recordReserveMs: 0 });
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.resultConfirmed, false);
});

test('records are opened in parallel lanes so CAPTCHA solves overlap, and every record is still read', async () => {
  let inFlight = 0, peak = 0;
  const h = napr({ parse: async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 20)); inFlight--; return { text: 'Official extract text that is long enough to read.', numpages: 1 }; } });
  const result = await runMyGovApiWorkflow(code, undefined, { fetch: h.fetch, parsePdf: h.parsePdf, recordConcurrency: 3 });
  assert.equal(peak, 3);
  assert.equal(result.documents.filter((d) => d.complete).length, 3);
  assert.equal(result.partial, false);
});

test('lanes follow the CAPTCHA policy: one without CAPTCHA, maxAttemptsPerProvider with it', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/workflows/mygov/MyGovApiWorkflow.ts', import.meta.url), 'utf8');
  assert.match(src, /options\.recordConcurrency\?\?\(options\.captcha\?\.policy\.enabled\?options\.captcha\.policy\.maxAttemptsPerProvider:1\)/);
});

test('only the first result page is read and only its first three records are opened (owner 2026-10-24)', async () => {
  const many = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const calls = [];
  const fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.endsWith('/api/search')) return json({ applist: many.map((id) => ({ appID: id, regNumber: 'reg-' + id })), page: 1, lastpage: 4, total: 40 });
    const id = many.find((x) => u.endsWith('/' + x));
    if (u.includes('/api/appstatus/')) return json({ status: 20 });
    if (u.includes('/api/app/')) return json({ appinfo: { r_info: [{ APP_ID: id, CADCODE: code, REG_NUMBER: 'reg-' + id }] }, edocuments: [{ DOC_NAME: 'd', ICON: 'signed-pdf', BLOB_URI: 'https://bs.napr.gov.ge/GetBlob?pid=' + id + '&bid=b' }], statuses: [], letters: [] });
    return new Response('%PDF-1.7 fixture', { headers: { 'Content-Type': 'application/pdf' } });
  };
  const result = await runMyGovApiWorkflow(code, undefined, { fetch, parsePdf: async () => ({ text: 'Official extract text that is long enough to read.', numpages: 1 }) });
  assert.equal(calls.filter((u) => u.endsWith('/api/search')).length, 1, 'one result page only');
  assert.equal(calls.filter((u) => u.includes('/api/app/')).length, 3);
  assert.deepEqual(result.recordsNotOpened, ['a4', 'a5']);
  assert.equal(result.status, 'SEARCH_CONFIRMED');
  assert.equal(result.documents.filter((d) => d.complete).length, 3);
});
