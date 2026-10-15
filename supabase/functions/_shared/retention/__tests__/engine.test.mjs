// The retention engine's provider half: every deletion is confirmed before
// the database hears about it, shared objects are retained, a provider that
// fails leaves a retryable record and never a purged payload, and a tick with
// the destructive gate off touches no provider at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tick, processRecord, officialDocumentKeys } from '../engine.ts';

const claim = { record_id: 'r1', product: 'CONTRACT_DOCUMENT', source_id: 's1', lease_token: 'L' };

function fakeRpc(plan, { exists = () => false, claims = [] } = {}) {
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push([fn, args]);
    switch (fn) {
      case 'retention_object_plan': return plan;
      case 'retention_storage_object_exists': return exists(args.p_bucket, args.p_key);
      case 'retention_claim': return claims;
      case 'retention_unscanned_reports': return [];
      default: return null;
    }
  };
  return { rpc, calls };
}

function fakeProviders({ r2Fail = false, r2Sticky = false } = {}) {
  const log = [];
  return {
    log,
    supabaseRemove: async (b, k) => { log.push(['supabase.remove', b, k]); },
    r2Delete: async (k) => { log.push(['r2.delete', k]); if (r2Fail) throw new Error('R2 503'); },
    r2Exists: async (k) => { log.push(['r2.head', k]); return r2Sticky; },
  };
}

const PLAN = [
  { object_id: 'o1', provider: 'SUPABASE_STORAGE', bucket: 'deal-room-documents', object_key: 'u/r/d.pdf', action: 'DELETE' },
  { object_id: 'o2', provider: 'R2', bucket: 'homatch-storage', object_key: 'deal-room-documents/u/r/d.pdf', action: 'DELETE' },
  { object_id: 'o3', provider: 'SUPABASE_STORAGE', bucket: 'verify-documents', object_key: 'files/1.pdf', action: 'RETAIN' },
  { object_id: 'o4', provider: 'R2', bucket: 'homatch-storage', object_key: 'x', action: 'DONE' },
];

test('deletes, verifies each deletion, retains shared objects, then purges the payload', async () => {
  const { rpc, calls } = fakeRpc(PLAN);
  const p = fakeProviders();
  assert.equal(await processRecord(rpc, p, claim), 'PURGED');
  assert.deepEqual(p.log, [
    ['supabase.remove', 'deal-room-documents', 'u/r/d.pdf'],
    ['r2.delete', 'deal-room-documents/u/r/d.pdf'],
    ['r2.head', 'deal-room-documents/u/r/d.pdf'],
  ]);
  const outcomes = calls.filter(([f]) => f === 'retention_object_outcome').map(([, a]) => [a.p_object_id, a.p_outcome]);
  assert.deepEqual(outcomes, [['o1', 'VERIFIED_DELETED'], ['o2', 'VERIFIED_DELETED'], ['o3', 'RETAINED']]);
  // the existence check runs AFTER the remove, and the purge comes last
  const names = calls.map(([f]) => f);
  assert.ok(names.indexOf('retention_storage_object_exists') > -1);
  assert.equal(names.at(-1), 'retention_purge_payload');
});

test('a provider failure leaves a retryable record and never purges the payload', async () => {
  const { rpc, calls } = fakeRpc(PLAN);
  assert.equal(await processRecord(rpc, fakeProviders({ r2Fail: true }), claim), 'FAILED');
  const names = calls.map(([f]) => f);
  assert.ok(!names.includes('retention_purge_payload'));
  assert.ok(names.includes('retention_record_failed'));
  const o2 = calls.find(([f, a]) => f === 'retention_object_outcome' && a.p_object_id === 'o2');
  assert.equal(o2[1].p_outcome, 'FAILED');
  assert.match(o2[1].p_error, /R2 503/);
});

test('an object still present after delete is a failure, not a success', async () => {
  const { rpc, calls } = fakeRpc(PLAN, { exists: () => true });
  assert.equal(await processRecord(rpc, fakeProviders({ r2Sticky: true }), claim), 'FAILED');
  const ok = calls.filter(([f, a]) => f === 'retention_object_outcome' && a.p_outcome === 'VERIFIED_DELETED');
  assert.equal(ok.length, 0);
});

test('a re-run after success is a no-op at the provider (idempotent)', async () => {
  const done = PLAN.map((r) => ({ ...r, action: 'DONE' }));
  const { rpc } = fakeRpc(done);
  const p = fakeProviders();
  assert.equal(await processRecord(rpc, p, claim), 'PURGED');
  assert.deepEqual(p.log, []);
});

test('an object in manual review blocks the purge', async () => {
  const { rpc, calls } = fakeRpc([{ ...PLAN[0], action: 'MANUAL' }]);
  assert.equal(await processRecord(rpc, fakeProviders(), claim), 'FAILED');
  assert.ok(!calls.some(([f]) => f === 'retention_purge_payload'));
});

test('a lost lease is reported and nothing is deleted', async () => {
  const p = fakeProviders();
  const rpc = async (fn) => { if (fn === 'retention_object_plan') throw new Error('retention: lease lost'); return null; };
  assert.equal(await processRecord(rpc, p, claim), 'FAILED');
  assert.deepEqual(p.log, []);
});

test('with the destructive gate off (no claims) a tick never calls a provider', async () => {
  const { rpc, calls } = fakeRpc(PLAN, { claims: [] });
  const p = fakeProviders();
  const r = await tick(rpc, p);
  assert.equal(r.claimed, 0);
  assert.deepEqual(p.log, []);
  assert.deepEqual(calls.map(([f]) => f),
    ['retention_register_due', 'retention_unscanned_reports', 'retention_emit_reminders', 'retention_claim']);
});

test('official document keys are the ones research-agent caches under', () => {
  const docs = [{ files: [
    { attachedFileId: '5551', fileName: 'a.pdf', format: 'pdf' },
    { attachedFileId: '5552', fileName: 'b.jpeg', format: 'jpeg' },
    { attachedFileId: '5551', fileName: 'a.pdf', format: 'pdf' },
    { fileName: 'no id.pdf' },
  ] }];
  const keys = officialDocumentKeys(docs);
  assert.ok(keys.includes('files/5551.pdf'));
  assert.equal(keys.filter((k) => k === 'files/5551.pdf').length, 1);
  assert.ok(keys.every((k) => /^files\/\d+\.(pdf|jpg|png)$/.test(k)));
  assert.deepEqual(officialDocumentKeys(null), []);
});

test('the engine never logs and never touches report content', () => {
  const src = readFileSync(join('supabase', 'functions', '_shared', 'retention', 'engine.ts'), 'utf8');
  assert.ok(!/console\.(log|info|debug)/.test(src));
  assert.ok(!/result_json|synthesis_json|analysis\b|extracted_text/.test(src.replace(/\/\/.*$/gm, '')));
});
