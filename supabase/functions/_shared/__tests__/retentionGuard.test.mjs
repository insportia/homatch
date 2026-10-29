// Retention guard for service-role routes: an expired report is refused with
// 410 everywhere RLS cannot see; a live or running one costs nothing and is
// served exactly as before; an unknown failure fails CLOSED; a database
// without the retention migration is treated as "nothing expired".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  retentionBlocked, retentionBlockedIds, expiredReportRefusal, expiredReportRefusalById, RetentionCheckUnavailable,
} from '../retentionGuard.ts';

const respond = (body, status) => ({ body, status });
const client = (impl) => {
  const calls = [];
  return { calls, rpc: async (fn, args) => { calls.push([fn, args]); return impl(fn, args); } };
};
const EXPIRED = 'aaaaaaaa-0000-0000-0000-000000000001';
const LIVE = 'aaaaaaaa-0000-0000-0000-000000000002';
const registry = client((fn, a) => fn === 'retention_access_blocked'
  ? { data: a.p_source_id === EXPIRED, error: null }
  : { data: a.p_ids.filter((x) => x === EXPIRED), error: null });

test('expired COMPLETE report -> 410 REPORT_EXPIRED; live report -> served (null)', async () => {
  assert.deepEqual(await expiredReportRefusal(registry, { id: EXPIRED, status: 'COMPLETE' }, respond),
    { body: { error: 'report_expired', code: 'REPORT_EXPIRED' }, status: 410 });
  assert.equal(await expiredReportRefusal(registry, { id: LIVE, status: 'COMPLETE' }, respond), null);
});

test('a running job never costs a round trip (polling path unchanged)', async () => {
  const c = client(() => { throw new Error('must not be called'); });
  for (const status of ['CREATED', 'QUEUED', 'RUNNING', 'WAITING_HUMAN', 'PAUSED', 'FAILED', 'CANCELLED']) {
    assert.equal(await expiredReportRefusal(c, { id: EXPIRED, status }, respond), null);
  }
  assert.equal(await expiredReportRefusal(c, null, respond), null);
  assert.equal(c.calls.length, 0);
});

test('before the migration exists nothing is expired (missing function)', async () => {
  for (const code of ['PGRST202', '42883']) {
    const c = client(() => ({ data: null, error: { code } }));
    assert.equal(await retentionBlocked(c, 'VERIFY_REPORT', EXPIRED), false);
    assert.equal((await retentionBlockedIds(c, 'VERIFY_REPORT', [EXPIRED])).size, 0);
  }
});

test('any other failure fails closed (503), never serves the report', async () => {
  const c = client(() => ({ data: null, error: { code: '57014', message: 'timeout' } }));
  await assert.rejects(retentionBlocked(c, 'VERIFY_REPORT', EXPIRED), RetentionCheckUnavailable);
  assert.equal((await expiredReportRefusal(c, { id: EXPIRED, status: 'COMPLETE' }, respond)).status, 503);
  assert.equal((await expiredReportRefusalById(c, EXPIRED, respond)).status, 503);
});

test('batch: exactly the expired ids; empty input asks nothing', async () => {
  assert.deepEqual([...await retentionBlockedIds(registry, 'VERIFY_REPORT', [EXPIRED, LIVE])], [EXPIRED]);
  const c = client(() => { throw new Error('must not be called'); });
  assert.equal((await retentionBlockedIds(c, 'VERIFY_REPORT', [])).size, 0);
});

/* ── Placement: every service-role route that can return report content or
 *    mint a document URL asks BEFORE it does so. ── */
const RA = readFileSync(join('supabase', 'functions', 'research-agent', 'index.ts'), 'utf8');

test('research-agent: every job action (status/resume/skip/cancel/pause/continue) is gated right after ownership', () => {
  const gate = "      if (!j) return json({ error: 'Job not found' }, 404);\n      { const expired = await expiredReportRefusal(sb, j, json); if (expired) return expired; }";
  assert.equal(RA.split(gate).length - 1, 4);
  for (const action of ["action === 'cancel'", "action === 'pause'", "action === 'continue'", "action === 'status' || action === 'resume' || action === 'skip'"]) {
    const at = RA.indexOf(`if (${action})`);
    assert.ok(at > 0, action);
    const next = RA.indexOf('expiredReportRefusal(sb, j, json)', at);
    const firstReturnOfJob = RA.indexOf('forCaller(', at);
    assert.ok(next > 0 && next < firstReturnOfJob, `${action}: gate must precede any job body`);
  }
});

test('research-agent status: the gate precedes the finished-response memo (no stale served body)', () => {
  const at = RA.indexOf("if (action === 'status' || action === 'resume' || action === 'skip')");
  assert.ok(RA.indexOf('expiredReportRefusal(sb, j, json)', at) < RA.indexOf('finishedResponseMemo.get(', at));
});

test('research-agent document_file: no signed URL is minted for an expired report', () => {
  const at = RA.indexOf("if (b?.action === 'document_file')");
  const gate = RA.indexOf('expiredReportRefusalById(sb, jobId, json)', at);
  assert.ok(gate > at);
  assert.ok(gate < RA.indexOf('createSignedUrl(', at), 'gate precedes signing');
  assert.ok(gate < RA.indexOf('/verify/tas-file', at), 'gate precedes a worker re-fetch');
});

test('research-agent: owner/internal regeneration actions are refused for an expired report', () => {
  const gate = RA.indexOf("['recover_visuals', 'fresh_photos', 'refresh_market'].includes(");
  assert.ok(gate > 0);
  for (const a of ['recover_visuals', 'fresh_photos', 'refresh_market']) {
    assert.ok(gate < RA.indexOf(`=== '${a}'`), `${a} gated before its handler`);
  }
});

test('homatch-ai: expired reports never reach the assistant context; failure gives none', () => {
  // The retrieval moved to ownContext.ts (privacy P0, 2026-10-29); the expiry check is passed in.
  const src = readFileSync(join('supabase', 'functions', 'homatch-ai', 'index.ts'), 'utf8');
  assert.match(src, /retentionBlockedIds\(sb, 'VERIFY_REPORT', ids\)/);
  const own = readFileSync(join('supabase', 'functions', 'homatch-ai', 'ownContext.ts'), 'utf8');
  assert.match(own, /catch \{\s+live = \[\];/);
  assert.match(own, /out\.verifications = live\.map/);
});

test('document analysis: expired document refused; an expired linked report is not read', () => {
  const src = readFileSync(join('supabase', 'functions', 'deal-room-document-analyze', 'index.ts'), 'utf8');
  const docGate = src.indexOf("retentionBlocked(supabase, 'CONTRACT_DOCUMENT', documentId)");
  // The file is read R2-first since 20261107090000; the gate still comes first.
  assert.ok(docGate > 0 && docGate < src.indexOf("readRouted(supabase, 'deal-room-documents', doc.storage_path)"));
  assert.match(src, /if \(room\?\.verify_job_id && !reportExpired\)/);
});

test('the guard changed nothing else in research-agent (only gate lines added)', () => {
  const lines = RA.split('\n').filter((l) => /retention|expiredReportRefusal|gateDb/i.test(l));
  assert.ok(lines.length <= 14, `unexpected retention lines: ${lines.length}`);
});
