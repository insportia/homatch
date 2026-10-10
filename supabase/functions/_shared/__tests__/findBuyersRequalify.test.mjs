// FIND BUYERS — correcting a finished campaign from its stored evidence: dry
// run changes nothing; apply writes categories/reasons next to each lead and
// keeps the previous classification; nothing is deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memDb } from './memDb.mjs';

globalThis.Deno ??= { env: { get: () => '' } };
const { requalifyCampaign } = await import('../findBuyers/admin.ts');
const { buildPropertyDna } = await import('../../../../src/research-core/findBuyers/propertyDna.ts');
const fixture = JSON.parse(readFileSync(new URL('../../../../src/research-core/__tests__/fixtures/villionCampaignLeads.json', import.meta.url), 'utf8'));

function seeded() {
  const dna = buildPropertyDna(fixture.property);
  return memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-v', dna, transaction: 'SALE' }],
    raw_signals: fixture.leads.map((l) => ({ id: `s${l.n}`, original_text: l.text, source_url: l.url, content_type: 'POST' })),
    find_buyers_leads: fixture.leads.map((l) => ({ id: `l${l.n}`, matching_job_id: 'job-v', best_signal_id: `s${l.n}`, author_name: l.author ?? `a${l.n}`,
      signal_at: l.at, evidence: [{ text: l.text.slice(0, 600), url: l.url }], intent_class: l.before, overall_score: 72, strength: 'GOOD', match_category: null, qualification: null })),
  });
}

test('dry run reports 37 → 2 and writes nothing', async () => {
  const { db, tables } = seeded();
  const r = await requalifyCampaign(db, 'job-v');
  assert.equal(r.before, 37);
  assert.equal(r.after.shown, 2);
  assert.equal(r.after.byCategory.STRONG, 0);
  assert.ok(tables.find_buyers_leads.every((l) => l.match_category === null && !l.requalified_at));
});

test('apply keeps every row and its evidence, records reasons and the previous verdict', async () => {
  const { db, tables } = seeded();
  await requalifyCampaign(db, 'job-v', true);
  assert.equal(tables.find_buyers_leads.length, 37, 'nothing deleted');
  const rejected = tables.find_buyers_leads.filter((l) => l.match_category === 'REJECTED');
  assert.equal(rejected.length, 35);
  for (const l of rejected) assert.ok(l.rejection_reasons.length > 0);
  for (const l of tables.find_buyers_leads) {
    assert.ok(l.evidence[0].text, 'evidence untouched');
    assert.equal(l.qualification.before.overallScore, 72);
    assert.ok(l.requalified_at);
  }
  const job = tables.find_buyers_leads.find((l) => l.id === 'l14');
  assert.deepEqual(job.rejection_reasons, ['JOB_SEARCH']);
});
