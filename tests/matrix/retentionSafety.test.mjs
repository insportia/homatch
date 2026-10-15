// Retention (20261102090000) is shipped DORMANT and can never be a mass
// deletion on apply. These assertions read the migration and the engine:
// if one fails, the premise of "safe to apply, nothing happens until the
// owner turns it on" no longer holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const M = readFileSync('supabase/migrations/20261102090000_storage_retention_lifecycle.sql', 'utf8');
const code = M.replace(/--.*$/gm, '');

test('everything destructive is seeded OFF and nothing is scheduled', () => {
  assert.match(code, /'purge_enabled', false/);
  assert.match(code, /'reminders_enabled', false/);
  assert.match(code, /'knowledge_enabled', false/);
  assert.match(code, /'effective_at', null/);
  assert.match(code, /on conflict \(key\) do nothing/, 'an owner-set value is never overwritten by a re-run');
  // The cron job exists only inside the admin switch (retention_set_schedule);
  // applying the migration schedules nothing.
  const schedFn = code.slice(code.indexOf('function public.retention_set_schedule'), code.indexOf('function public.retention_scheduled'));
  assert.equal((code.match(/cron\.schedule\(/g) ?? []).length, 1);
  assert.match(schedFn, /cron\.schedule\(/);
  const calls = [...code.matchAll(/perform public\.retention_set_schedule\(/g)].map((m) => m.index);
  const cfg = [code.indexOf('function public.retention_admin_configure'), code.indexOf('function public.retention_admin_records')];
  assert.ok(calls.length === 1 && calls[0] > cfg[0] && calls[0] < cfg[1], 'only the admin switch can schedule; the migration itself turns nothing on');
});

test('the claim refuses all work while purge_enabled is false', () => {
  const claim = code.slice(code.indexOf('function public.retention_claim'), code.indexOf('function public.retention_object_plan'));
  assert.match(claim, /if not coalesce\(\(v_cfg ->> 'purge_enabled'\)::boolean, false\) then\s+return;/);
});

test('no Verify, billing, ledger or document ROW is ever deleted — only payload columns are cleared', () => {
  for (const t of ['research_jobs', 'verify_billing', 'deal_room_documents', 'deal_rooms', 'storage_objects', 'wallet', 'credit']) {
    assert.ok(!new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, 'i').test(code), `a DELETE from ${t}`);
  }
  assert.ok(!/truncate/i.test(code));
  assert.ok(!/drop\s+table/i.test(code));
  // the only row deletion: findings of one already-expired, claimed document
  const deletes = [...code.matchAll(/delete\s+from\s+([\w.]+)/gi)].map((m) => m[1]);
  assert.deepEqual(deletes, ['public.deal_room_document_findings']);
});

test('expiry is one rule, immutable, and never extended by a read', () => {
  assert.match(code, /function public\.retention_expiry\(p_available_at timestamptz\)/);
  assert.match(code, /interval '30 days'\) at time zone 'UTC'/);
  assert.match(code, /expires_at is immutable once set/);
  assert.equal((code.match(/\+ interval '30 days'/g) ?? []).length, 1, 'a second 30-day expiry calculation exists');
  // the access gates only read
  const gate = code.slice(code.indexOf('function public.retention_access_blocked'), code.indexOf('function public.retention_object_blocked'));
  assert.ok(!/update|insert/i.test(gate));
});

test('access gates are deny-only (restrictive) policies', () => {
  const policies = [...code.matchAll(/create policy (\w+) on ([\w.]+)\s+as (\w+) for (\w+)/g)].map((m) => [m[1], m[2], m[3], m[4]]);
  assert.equal(policies.length, 4);
  for (const [, , kind, cmd] of policies) {
    assert.equal(kind, 'restrictive');
    assert.equal(cmd, 'select');
  }
});

test('the knowledge layer has no user, job, address, URL or listing identifier column', () => {
  const table = code.slice(code.indexOf('create table if not exists public.market_observations'), code.indexOf('create index if not exists market_observations_segment_idx'));
  for (const forbidden of ['user', 'job', 'address', 'url', 'listing_id', 'project', 'cadastral', 'phone', 'email']) {
    assert.ok(!new RegExp(`^\\s+${forbidden}\\w*\\s`, 'mi').test(table), `market_observations has a ${forbidden} column`);
  }
  assert.match(table, /price_kind text not null default 'ASKING' check \(price_kind = 'ASKING'\)/);
});

test('protected Verify and Contracts paths change ONLY by the approved retention guards', () => {
  let base;
  try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim(); } catch { return; }
  const changed = execFileSync('git', ['diff', '--name-only', base, '--'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!changed.some((f) => f.includes('storage_retention_lifecycle'))) return; // only meaningful on this branch
  const PROTECTED = [
    /^supabase\/functions\/(research-agent|verify-synthesis|verify-queue|deal-room-document-analyze|deal-room-ai|verification-handoff|jobs-worker|homatch-ai)\//,
    /^official-worker\//, /^src\/verify\//, /^src\/components\/verify\//, /^src\/pages\/VerifyPage\.tsx$/,
    /^src\/services\/(researchJobs|verifyResult|verifyReportPrefetch|verifyDocumentFile|contracts|dealRoomDocuments|documentWorkspace)\.ts$/,
    /^src\/pages\/Contract(s|Result)Page\.tsx$/, /^src\/components\/(contracts|documents)\//,
  ];
  // Owner approval (2026-10-15): a minimal server-side expiration guard. These
  // exact lines and nothing else; any other edit to a protected path fails here.
  const APPROVED_GUARD_FILES = new Set([
    'supabase/functions/research-agent/index.ts',
    'supabase/functions/deal-room-document-analyze/index.ts',
    'supabase/functions/homatch-ai/index.ts',
  ]);
  const APPROVED_LINES = new Set([
    "+        && /^[0-9a-f-]{36}$/i.test(String(preAuthBody?.jobId || ''))) {",
    "+      : false;",
    "+      ? await retentionBlocked(supabase, 'VERIFY_REPORT', room.verify_job_id).catch(() => true)",
    "+      const expired = await expiredReportRefusalById(gateDb, String(preAuthBody.jobId), json);",
    "+      const gateDb = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');",
    "+      if (await retentionBlocked(supabase, 'CONTRACT_DOCUMENT', documentId)) return json({ error: 'document_expired' }, 410);",
    "+      if (expired) return expired;",
    "+      return json({ error: 'retention_check_unavailable' }, 503);",
    "+      { const expired = await expiredReportRefusal(sb, j, json); if (expired) return expired; } // retention (20261102090000)",
    "+      { const expired = await expiredReportRefusalById(sb, jobId, json); if (expired) return expired; } // retention: no signed URL after expiry",
    "+    // An expired Verify report is not carried into a new analysis (retention).",
    "+    // RETENTION (20261102090000): an expired report is never refreshed, re-fetched",
    "+    // Retention (20261102090000): an expired document is never re-analysed —",
    "+    // or re-pictured on request — by its owner or by an internal caller.",
    "+    // the worker path reads with the service role, so it asks explicitly.",
    "+    const expired = await retentionBlockedIds(sb, 'VERIFY_REPORT', liveReports.map((j: any) => j.id));",
    "+    const reportExpired = room?.verify_job_id",
    "+    if (['recover_visuals', 'fresh_photos', 'refresh_market'].includes(String(preAuthBody?.action || ''))",
    "+    if (room?.verify_job_id && !reportExpired) {",
    "+    liveReports = [];",
    "+    liveReports = liveReports.filter((j: any) => !expired.has(j.id));",
    "+    try {",
    "+    }",
    "+    } catch {",
    "+  // Retention (20261102090000): an expired report is not handed to the",
    "+  // assistant. If expiry cannot be checked, no report context is given.",
    "+  internal.verifications = liveReports.map((j: any) => {",
    "+  let liveReports: any[] = v || [];",
    "+  try {",
    "+  }",
    "+  } catch {",
    "+import { expiredReportRefusal, expiredReportRefusalById } from '../_shared/retentionGuard.ts';",
    "+import { retentionBlocked } from '../_shared/retentionGuard.ts';",
    "+import { retentionBlockedIds } from '../_shared/retentionGuard.ts';",
    "-    if (room?.verify_job_id) {",
    "-  internal.verifications = (v || []).map((j: any) => {",
  ]);
  const hit = changed.filter((f) => PROTECTED.some((re) => re.test(f)));
  assert.deepEqual(hit.filter((f) => !APPROVED_GUARD_FILES.has(f)), [], 'a protected path outside the approved guard changed');
  for (const f of hit) {
    const lines = execFileSync('git', ['diff', '-U0', base, '--', f], { encoding: 'utf8' }).split('\n')
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    const extra = lines.filter((l) => !APPROVED_LINES.has(l));
    assert.deepEqual(extra, [], `${f}: change beyond the approved retention guard`);
  }
});

test('the engine and the tick never read report content', () => {
  for (const f of ['supabase/functions/_shared/retention/engine.ts', 'supabase/functions/storage-retention/index.ts']) {
    assert.ok(existsSync(f));
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/result_json|synthesis_json|extracted_text|\.from\('research_jobs'\)|\.from\('deal_room_documents'\)/.test(src), f);
  }
});
