// Migration / deployment compatibility gate: Edge Functions never deploy ahead of the
// migrations they need (2026-10-19 Finance V2: 3.4 days of Edge code ahead of its schema).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, normalizeSql, sqlHash } from '../../scripts/release/migration-gate.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const mig = (stem, sql = `-- ${stem}\nselect 1;\n`) => ({ version: stem.slice(0, 14), stem, name: stem.slice(15), hash: sqlHash(sql) });
const manifest = {
  contentVerifiedFrom: '20261119140000',
  reconciled: { '20260926180000_one_match_per_signal': { proof: 'select true', note: 'index present' } },
  held: { '20261108090000_publishing_central_accounts': { reason: 'owner hold', dependents: ['publishing-engine'] } },
};

test('a repo migration missing from the ledger fails the deploy (the Finance V2 incident)', () => {
  const r = evaluate({ migrations: [mig('20261119140000_finance_v2_engine')], ledger: [], manifest });
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].state, 'PENDING');
});

test('applied under its own version, under an MCP version by name, or by full stem: all pass', () => {
  const a = mig('20261119140000_finance_v2_engine'), b = mig('20261117090000_find_property_campaign_results'), c = mig('20261119130000_find_property_costs');
  const ledger = [
    { version: '20261022164954', name: 'finance_v2_engine', hash: a.hash },
    { version: '20261018181039', name: '20261117090000_find_property_campaign_results', hash: null },
    { version: '20261119130000', name: 'whatever', hash: null },
  ];
  const r = evaluate({ migrations: [a, b, c], ledger, manifest });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
});

test('content: from contentVerifiedFrom the applied SQL must equal the committed file; before, reported only', () => {
  const newer = mig('20261119150000_next', 'select 2;');
  const older = mig('20261119120000_find_buyers_min_5_execution_budget', 'select 3;');
  const ledger = [{ version: '20261023000000', name: 'next', hash: sqlHash('select 999;') },
                  { version: '20261019053127', name: 'find_buyers_min_5_execution_budget', hash: sqlHash('select 4;') }];
  const r = evaluate({ migrations: [newer, older], ledger, manifest });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.map((f) => f.stem), ['20261119150000_next']);
  assert.equal(r.rows.find((x) => x.stem.endsWith('budget')).content, 'DIFFERS');
});

test('normalisation only forgives CR and trailing whitespace, never a changed statement', () => {
  assert.equal(sqlHash('select 1;\r\n  \n'), sqlHash('select 1;'));
  assert.equal(normalizeSql('a  \nb\t\n'), 'a\nb');
  assert.notEqual(sqlHash('select 1;'), sqlHash('select 2;'));
});

test('reconciled entries pass only while their production proof returns true', () => {
  const m = mig('20260926180000_one_match_per_signal');
  assert.equal(evaluate({ migrations: [m], ledger: [], manifest, proofs: { [m.stem]: true } }).ok, true);
  assert.equal(evaluate({ migrations: [m], ledger: [], manifest, proofs: {} }).ok, false);
});

test('a held migration blocks only deploys of the functions that depend on it', () => {
  const m = mig('20261108090000_publishing_central_accounts');
  assert.equal(evaluate({ migrations: [m], ledger: [], manifest, owed: ['match-campaign'] }).ok, true);
  const r = evaluate({ migrations: [m], ledger: [], manifest, owed: ['match-campaign', 'publishing-engine'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures[0].blocking, ['publishing-engine']);
});

test('deploy.yml runs the gate before any Edge upload and when recording the frontend', () => {
  const wf = read('.github/workflows/deploy.yml');
  const job = wf.slice(wf.indexOf('  deploy-functions:'), wf.indexOf('  summary:'));
  const gate = job.indexOf('node scripts/release/migration-gate.mjs --owed "$RUNNER_TEMP/owed.txt"');
  assert.ok(gate > 0, 'gate step in deploy-functions');
  assert.ok(gate < job.indexOf('name: Production, before') && gate < job.indexOf('Deploy functions — JWT required'), 'before snapshot and upload');
  const fe = wf.slice(wf.indexOf('  build-frontend:'), wf.indexOf('  migrate:'));
  assert.match(fe, /node scripts\/release\/migration-gate\.mjs/, 'frontend record is gated too');
  const manifestJson = JSON.parse(read('supabase/migration-gate.json'));
  for (const [stem, rec] of Object.entries(manifestJson.reconciled)) {
    assert.match(rec.proof, /^select /i, `${stem}: proof is a read-only SELECT`);
    assert.doesNotMatch(rec.proof, /\b(insert|update|delete|drop|alter|create|grant|truncate)\b/i, `${stem}: proof never writes`);
  }
});
