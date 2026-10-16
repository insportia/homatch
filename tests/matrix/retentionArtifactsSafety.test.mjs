// Object-level retention (20261104090000) — the owner's 2026-10-16 decision,
// pinned. Only an explicit allowlist of disposable storage objects can ever be
// deleted; Verify results, Contracts originals, evidence, report visuals, the
// Design Studio catalog and every customer upload are out of scope; record-
// level deletion is retired; applying the migration deletes and schedules
// nothing. If one of these fails, that premise no longer holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'supabase/migrations/20261104090000_storage_retention_artifacts.sql';
const code = readFileSync(FILE, 'utf8').replace(/--.*$/gm, '');
const fnBody = (name, next) => code.slice(code.indexOf(`function public.${name}`), next ? code.indexOf(`function public.${next}`) : undefined);

test('applying it deletes nothing, drops nothing and schedules nothing', () => {
  assert.ok(!/\bdelete\s+from\b/i.test(code), 'a DELETE statement');
  assert.ok(!/\btruncate\b/i.test(code));
  assert.ok(!/\bdrop\s+(table|function|schema|policy)\b/i.test(code));
  assert.ok(!/cron\.schedule\(/.test(code), 'the migration schedules a job');
  assert.ok(!/create\s+trigger[^;]+on\s+storage\./i.test(code), 'a trigger on Supabase Storage');
  // the only schedule switch is the validated configure, and only when asked
  const calls = [...code.matchAll(/perform public\.retention_set_schedule\(/g)].length;
  assert.equal(calls, 1);
  assert.match(fnBody('retention_artifacts_configure', 'retention_category_set'), /if p_patch \? 'auto_run' then\s+perform public\.retention_set_schedule/);
});

test('real categories are seeded disabled and never retroactive; settings never overwrite the owner', () => {
  for (const key of ['verify_document_cache', 'generated_report']) {
    const row = code.match(new RegExp(`\\('${key}',[\\s\\S]*?\\)(,|\\n)`))?.[0] ?? '';
    assert.match(row, /, false, null\)$|false, null\),?$/m, `${key} is not seeded disabled with active_since null`);
  }
  assert.match(code, /'storage_retention_artifacts'[\s\S]*?on conflict \(key\) do nothing/);
  assert.match(code, /active_since never moves/);
  assert.match(fnBody('retention_register_artifacts', 'retention_artifact_notices'), /created_at >= c\.active_since/);
  assert.match(fnBody('retention_register_artifact', 'retention_register_artifacts'), /RETENTION_NOT_PROSPECTIVE/);
});

test('the allowlist names exactly four locations and none of the protected ones', () => {
  const allow = fnBody('retention_location_eligible', 'retention_protected_areas');
  assert.equal((allow.match(/p_key ~ '/g) ?? []).length, 4);
  for (const protectedArea of ['design-studio', 'deal-room-documents', 'verify-evidence', 'verify-official-visuals', 'meta-ads-media',
    'voice-auditions', 'property-photos', 'developer-', 'broker-', 'dm-media', 'live-chat-media', 'mortgage-offer-documents', 'site-assets']) {
    assert.ok(!allow.includes(protectedArea), `${protectedArea} is in the allowlist`);
  }
  // categories can only describe allowlisted buckets, and their scope is fixed
  const guard = fnBody('retention_categories_guard');
  assert.match(guard, /new\.bucket = 'verify-documents'/);
  assert.match(guard, /new\.bucket in \('users', 'retention-selftest'\)/);
  assert.match(guard, /scope is fixed by migration/);
});

test('every deletion path re-checks the allowlist, honours the kill switch and the owner notice', () => {
  const claim = fnBody('retention_artifacts_claim', 'retention_artifacts_outcome');
  assert.match(claim, /if coalesce\(\(v_cfg ->> 'paused'\)::boolean, true\) then\s+return;/, 'a missing setting must mean paused');
  assert.match(claim, /retention_location_eligible\(r\.provider, r\.bucket, r\.object_key\)/);
  assert.match(claim, /BLOCKED:AWAITING_NOTICE/);
  assert.match(claim, /for update of a skip locked/);
  const outcome = fnBody('retention_artifacts_outcome', 'retention_artifacts_log_tick');
  assert.match(outcome, /lease lost/);
  // a cache that cannot prove it can be rebuilt is kept
  assert.match(outcome, /NOT_REGENERABLE[\s\S]*?state = case when attempts >= v_max then 'DEAD_LETTER' else 'ACTIVE' end/);
  assert.match(code, /check \(kind <> 'REGENERABLE_CACHE' or \(regeneration is not null and not notify_owner\)\)/);
});

test('record-level retention is retired: no report or document can be claimed or re-enabled', () => {
  const claim = code.slice(code.indexOf('function public.retention_claim('), code.indexOf('function public.retention_admin_configure('));
  assert.match(claim, /begin\s+return;\s+end/);
  const cfg = code.slice(code.indexOf('function public.retention_admin_configure('), code.indexOf('do $$'));
  assert.match(cfg, /raise exception 'RETENTION_RECORD_LEVEL_RETIRED'/);
  // and no code path in the engine reaches the old functions
  const engine = readFileSync('supabase/functions/_shared/retention/engine.ts', 'utf8').replace(/\/\/.*$/gm, '');
  for (const old of ['retention_claim', 'retention_purge_payload', 'retention_object_plan', 'retention_register_due']) {
    assert.ok(!engine.includes(`'${old}'`), `engine calls ${old}`);
  }
});

test('the engine and the registry are service-only; admin views require an operator', () => {
  const priv = code.slice(code.indexOf('do $$'));
  const serviceOnly = priv.slice(0, priv.indexOf('loop'));
  for (const f of ['retention_artifacts_claim', 'retention_artifacts_outcome', 'retention_register_artifact(', 'retention_artifact_notices']) {
    assert.ok(serviceOnly.includes(f), `${f} is not service-only`);
  }
  for (const f of ['retention_artifacts_status', 'retention_artifacts_list', 'retention_artifacts_preview', 'retention_artifacts_configure',
    'retention_category_set', 'retention_artifacts_requeue', 'retention_artifacts_events']) {
    assert.match(fnBody(f), /if not public\.retention_operator_allowed\(\) then raise exception 'forbidden'/, `${f} has no operator check`);
  }
});

test('protected Verify, Contracts, Design Studio and Meta Ads code is untouched by this change', () => {
  let base;
  try { base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim(); } catch { return; }
  const changed = execFileSync('git', ['diff', '--name-only', base, '--'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!changed.includes(FILE)) return; // only meaningful on the branch that adds it
  const PROTECTED = [
    /^supabase\/functions\/(research-agent|verify-synthesis|verify-queue|deal-room-document-analyze|deal-room-ai|verification-handoff|jobs-worker|homatch-ai|storage-sign)\//,
    /^supabase\/functions\/(design-studio|meta-)/, /^official-worker\//, /^src\/verify\//, /^src\/components\/verify\//,
    /^src\/pages\/(VerifyPage|VerifyHistoryPage|ContractsHistoryPage|ContractsPage|ContractResultPage)\.tsx$/,
    /^src\/components\/(contracts|documents|design-studio|meta-ads)\//, /^src\/services\/(researchJobs|verifyResult|contracts|dealRoomDocuments)\.ts$/,
  ];
  assert.deepEqual(changed.filter((f) => PROTECTED.some((re) => re.test(f))), []);
});
