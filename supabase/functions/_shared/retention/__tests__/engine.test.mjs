// The retention engine's provider half (object level): a cache file is
// deleted only after its source proved it can be rebuilt, every deletion is
// confirmed at the provider before the database hears about it, a protected
// key is refused even if the database hands it over, a failing provider leaves
// a retryable artifact, and a paused tick touches no provider at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tick, processArtifact, eligibleLocation, tasAttachmentId } from '../engine.ts';

const cache = {
  artifact_id: 'a1', category: 'verify_document_cache', kind: 'REGENERABLE_CACHE', regeneration: 'VERIFY_TAS_DOCUMENT',
  provider: 'SUPABASE_STORAGE', bucket: 'verify-documents', object_key: 'files/123456.pdf', lease_token: 'L1',
};
const r2File = {
  artifact_id: 'a2', category: 'selftest_r2', kind: 'SELFTEST', regeneration: null,
  provider: 'R2', bucket: 'retention-selftest', object_key: 'retention-selftest/11111111-2222-3333-4444-555555555555.txt', lease_token: 'L2',
};

function fakeRpc({ exists = [true, false], claims = [] } = {}) {
  const calls = [];
  const seen = [...exists];
  const rpc = async (fn, args) => {
    calls.push([fn, args]);
    switch (fn) {
      case 'retention_storage_object_exists': return seen.length ? seen.shift() : false;
      case 'retention_artifacts_claim': return claims;
      case 'retention_register_artifacts': return 0;
      case 'retention_artifact_notices': return { queued: 0 };
      default: return null;
    }
  };
  return { rpc, calls };
}

function fakeProviders({ regenerable = true, r2Fail = false, r2Present = [true, false] } = {}) {
  const log = [];
  const r2 = [...r2Present];
  return {
    log,
    supabaseRemove: async (b, k) => { log.push(['supabase.remove', b, k]); },
    r2Delete: async (k) => { log.push(['r2.delete', k]); if (r2Fail) throw new Error('R2 503'); },
    r2Exists: async (k) => { log.push(['r2.head', k]); return r2.length ? r2.shift() : false; },
    regenerate: async (m, k) => {
      log.push(['regenerate', m, k]);
      return regenerable
        ? { regenerable: true, method: m, status: 200, contentType: 'application/pdf', bytes: 1000, checkedAt: 'now' }
        : { regenerable: false, method: m, status: 502, error: 'source answered 502', checkedAt: 'now' };
    },
  };
}

const outcomes = (calls) => calls.filter(([f]) => f === 'retention_artifacts_outcome').map(([, a]) => a.p_outcome);

test('a cache file: regeneration proven, present, removed, confirmed gone, then reported', async () => {
  const { rpc, calls } = fakeRpc({ exists: [true, false] });
  const p = fakeProviders();
  assert.equal(await processArtifact(rpc, p, cache), 'DELETED');
  assert.deepEqual(p.log, [['regenerate', 'VERIFY_TAS_DOCUMENT', 'files/123456.pdf'], ['supabase.remove', 'verify-documents', 'files/123456.pdf']]);
  const names = calls.map(([f]) => f);
  assert.deepEqual(names, ['retention_storage_object_exists', 'retention_storage_object_exists', 'retention_artifacts_outcome']);
  const done = calls.at(-1)[1];
  assert.equal(done.p_outcome, 'VERIFIED_DELETED');
  assert.equal(done.p_detail.regeneration.regenerable, true);
});

test('a cache file that cannot be rebuilt is KEPT and storage is never touched', async () => {
  const { rpc, calls } = fakeRpc();
  const p = fakeProviders({ regenerable: false });
  assert.equal(await processArtifact(rpc, p, cache), 'KEPT');
  assert.deepEqual(p.log.map((l) => l[0]), ['regenerate']);
  assert.deepEqual(outcomes(calls), ['NOT_REGENERABLE']);
});

test('a cache category without a regeneration method is never deleted', async () => {
  const { rpc, calls } = fakeRpc();
  const p = fakeProviders();
  assert.equal(await processArtifact(rpc, p, { ...cache, regeneration: null }), 'KEPT');
  assert.equal(p.log.length, 0);
  assert.deepEqual(outcomes(calls), ['NOT_REGENERABLE']);
});

test('an object still present after delete is a failure, not a deletion', async () => {
  const { rpc, calls } = fakeRpc({ exists: [true, true] });
  const p = fakeProviders();
  assert.equal(await processArtifact(rpc, p, cache), 'FAILED');
  assert.deepEqual(outcomes(calls), ['FAILED']);
  assert.match(calls.at(-1)[1].p_error, /still present/);
});

test('an object already gone is recorded as such without a delete call', async () => {
  const { rpc, calls } = fakeRpc({ exists: [false] });
  const p = fakeProviders();
  assert.equal(await processArtifact(rpc, p, cache), 'GONE');
  assert.ok(!p.log.some((l) => l[0] === 'supabase.remove'));
  assert.deepEqual(outcomes(calls), ['ALREADY_GONE']);
});

test('R2: delete then HEAD; a provider error leaves a retryable failure', async () => {
  const ok = fakeRpc();
  const p = fakeProviders();
  assert.equal(await processArtifact(ok.rpc, p, r2File), 'DELETED');
  assert.deepEqual(p.log.map((l) => l[0]), ['r2.head', 'r2.delete', 'r2.head']);
  const bad = fakeRpc();
  assert.equal(await processArtifact(bad.rpc, fakeProviders({ r2Fail: true }), r2File), 'FAILED');
  assert.deepEqual(outcomes(bad.calls), ['FAILED']);
});

test('the engine refuses a protected key even if the database hands it over', async () => {
  for (const evil of [
    { ...r2File, bucket: 'design-studio', object_key: 'design-studio/catalog/public/hdri/x/y/lot_1k.hdr' },
    { ...cache, bucket: 'deal-room-documents', object_key: 'aaaa/contract.pdf' },
    { ...cache, bucket: 'verify-evidence', object_key: 'sha256/ab/x.txt' },
    { ...cache, object_key: 'files/../x.pdf' },
  ]) {
    const { rpc, calls } = fakeRpc();
    const p = fakeProviders();
    assert.equal(await processArtifact(rpc, p, evil), 'FAILED');
    assert.equal(p.log.length, 0, `${evil.bucket}/${evil.object_key} reached a provider`);
    assert.match(calls.at(-1)[1].p_error, /NOT_ELIGIBLE/);
  }
});

test('the engine allowlist matches the migration allowlist exactly', () => {
  assert.ok(eligibleLocation('SUPABASE_STORAGE', 'verify-documents', 'files/1.pdf'));
  assert.ok(eligibleLocation('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/generated-reports/11111111-0000-0000-0000-000000000001.pdf'));
  assert.ok(!eligibleLocation('R2', 'users', 'users/aaaaaaaa-0000-0000-0000-00000000000a/design-studio-thumbnails/x/y.webp'));
  assert.ok(!eligibleLocation('SUPABASE_STORAGE', 'verify-official-visuals', 'tas/abc.jpg'));
  const sql = readFileSync('supabase/migrations/20261104090000_storage_retention_artifacts.sql', 'utf8');
  const fn = sql.slice(sql.indexOf('function public.retention_location_eligible'), sql.indexOf('function public.retention_protected_areas'));
  const sqlPatterns = [...fn.matchAll(/p_key ~ '([^']+)'/g)].map((m) => m[1]).sort();
  const src = readFileSync('supabase/functions/_shared/retention/engine.ts', 'utf8');
  const eng = src.slice(src.indexOf('export function eligibleLocation'), src.indexOf('export function tasAttachmentId'));
  const tsPatterns = [...eng.matchAll(/\/(\^[^/]*(?:\\\/[^/]*)*\$)\/\.test/g)].map((m) => m[1].replace(/\\\//g, '/')).sort();
  assert.equal(sqlPatterns.length, 4, 'the SQL allowlist has exactly four locations');
  assert.deepEqual(tsPatterns, sqlPatterns);
});

test('tasAttachmentId only reads the cache key shape', () => {
  assert.equal(tasAttachmentId('files/987.pdf'), '987');
  assert.equal(tasAttachmentId('retention-selftest/x.pdf'), null);
  assert.equal(tasAttachmentId('files/987.docx'), null);
});

test('a paused tick (no claims) registers and queues notices but touches no provider', async () => {
  const { rpc, calls } = fakeRpc({ claims: [] });
  const p = fakeProviders();
  const report = await tick(rpc, p, { sleep: async () => {} });
  assert.equal(report.claimed, 0);
  assert.equal(p.log.length, 0);
  assert.deepEqual(calls.map(([f]) => f), ['retention_register_artifacts', 'retention_artifact_notices', 'retention_artifacts_claim']);
});

test('a tick counts each outcome', async () => {
  const { rpc } = fakeRpc({ claims: [cache, r2File], exists: [true, false] });
  const report = await tick(rpc, fakeProviders(), { sleep: async () => {} });
  assert.equal(report.claimed, 2);
  assert.equal(report.deleted, 2);
  assert.equal(report.failed, 0);
});

test('the engine has no record-level code path left', () => {
  const src = readFileSync('supabase/functions/_shared/retention/engine.ts', 'utf8').replace(/\/\/.*$/gm, '');
  for (const gone of ['retention_claim', 'retention_purge_payload', 'retention_object_plan', 'retention_register_due', 'retention_emit_reminders']) {
    assert.ok(!src.includes(`'${gone}'`), `engine still calls ${gone}`);
  }
});
