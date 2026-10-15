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
  assert.ok(!/cron\.schedule/.test(code), 'activation (the cron job) is a separate, approved step');
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

test('protected Verify and Contracts execution paths are untouched by this change', () => {
  let base;
  try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim(); } catch { return; }
  const changed = execFileSync('git', ['diff', '--name-only', base, '--'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const ownChange = changed.some((f) => f.includes('storage_retention_lifecycle'));
  if (!ownChange) return; // only meaningful on the branch that carries this migration
  const PROTECTED = [
    /^supabase\/functions\/(research-agent|verify-synthesis|verify-queue|deal-room-document-analyze|deal-room-ai|verification-handoff|jobs-worker)\//,
    /^official-worker\//, /^src\/verify\//, /^src\/components\/verify\//, /^src\/pages\/VerifyPage\.tsx$/,
    /^src\/services\/(researchJobs|verifyResult|verifyReportPrefetch|verifyDocumentFile|contracts|dealRoomDocuments|documentWorkspace)\.ts$/,
    /^src\/pages\/Contract(s|Result)Page\.tsx$/, /^src\/components\/(contracts|documents)\//,
  ];
  const hit = changed.filter((f) => PROTECTED.some((re) => re.test(f)));
  assert.deepEqual(hit, [], `protected paths changed: ${hit.join(', ')}`);
});

test('the engine and the tick never read report content', () => {
  for (const f of ['supabase/functions/_shared/retention/engine.ts', 'supabase/functions/storage-retention/index.ts']) {
    assert.ok(existsSync(f));
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/result_json|synthesis_json|extracted_text|\.from\('research_jobs'\)|\.from\('deal_room_documents'\)/.test(src), f);
  }
});
