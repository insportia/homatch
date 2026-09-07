// Pure-logic regression test for the 2026-09-07 "ProjectRevision/
// block-structure" mandate item, generic interpretation:
//   - track multiple official TAS/project revisions over time
//   - if a project has multiple buildings/blocks/phases explicitly
//     evidenced, preserve each block/phase separately
//   - never invent a block structure if documents do not support it
//   - timeline should show revision/amendment chronology
//   - block/building-specific facts stay attached to the correct block
//     when identifiable
// Tests the block-attribution step inside aggregateTasTechnicalFacts() and
// the buildRevisionTimeline() function, both in
// supabase/functions/research-agent/index.ts, copied verbatim per this
// repo's established pattern (a Deno edge function this sandbox cannot
// import directly — see companyProfileReconciliationFallback.test.mjs in
// this same directory). Keep both in sync with the real functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- copied verbatim from supabase/functions/research-agent/index.ts ---
function aggregateTasTechnicalFacts(browserOfficial) {
  const out = [];
  for (const r of browserOfficial?.results || []) {
    for (const d of r.documents || []) {
      const facts = Array.isArray(d.technicalFacts) ? d.technicalFacts : [];
      const blockFact = facts.find((f) => f?.key === 'buildingBlock' || f?.key === 'buildingLiter');
      const block = blockFact?.value ? String(blockFact.value).trim() || null : null;
      for (const f of facts) {
        if (!f || !f.category || !f.key || !f.value) continue;
        out.push({
          category: String(f.category),
          key: String(f.key),
          value: String(f.value),
          confidence: f.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
          documentUrl: d.url || null,
          documentTitle: d.title || d.label || null,
          documentDate: d.date || d.documentDate || null,
          block,
        });
      }
    }
  }
  const byId = new Map();
  for (const f of out) {
    const id = `${f.category}::${f.key}::${f.value}::${f.block || ''}`;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, f);
      continue;
    }
    const upgrade = (existing.confidence === 'MEDIUM' && f.confidence === 'HIGH') || (existing.confidence === f.confidence && !existing.documentDate && !!f.documentDate);
    if (upgrade) byId.set(id, f);
  }
  return Array.from(byId.values());
}
function buildRevisionTimeline(facts) {
  const byDoc = new Map();
  for (const f of facts) {
    const id = `${f.documentTitle || ''}::${f.documentDate || ''}`;
    if (!byDoc.has(id)) byDoc.set(id, { documentTitle: f.documentTitle, documentDate: f.documentDate, block: f.block, facts: [] });
    byDoc.get(id).facts.push({ category: f.category, key: f.key, value: f.value });
  }
  const groups = Array.from(byDoc.values());
  const distinctKnownDates = new Set(groups.map((g) => g.documentDate).filter(Boolean));
  if (distinctKnownDates.size < 2) return null;
  const dated = groups.filter((g) => g.documentDate).sort((a, b) => String(a.documentDate).localeCompare(String(b.documentDate)));
  const undated = groups.filter((g) => !g.documentDate);
  return [...dated, ...undated];
}

function doc(url, title, date, technicalFacts) {
  return { url, title, date, technicalFacts };
}

test('aggregateTasTechnicalFacts: a document naming a block attaches that block to every fact it contributed, not just the block fact itself', () => {
  const browserOfficial = {
    results: [{ source: 'tas', documents: [doc('u1', 'Permit A', '2023-01-01', [
      { category: 'PROJECT', key: 'buildingBlock', value: '2', confidence: 'HIGH' },
      { category: 'PROJECT', key: 'floors', value: '9', confidence: 'HIGH' },
    ])] }],
  };
  const facts = aggregateTasTechnicalFacts(browserOfficial);
  const floors = facts.find((f) => f.key === 'floors');
  assert.equal(floors.block, '2');
});

test('aggregateTasTechnicalFacts: a document that never names a block leaves block null on all its facts — never inferred from another document', () => {
  const browserOfficial = {
    results: [{ source: 'tas', documents: [
      doc('u1', 'Permit A', '2023-01-01', [{ category: 'PROJECT', key: 'buildingBlock', value: '2', confidence: 'HIGH' }]),
      doc('u2', 'Permit B', '2023-06-01', [{ category: 'PROJECT', key: 'floors', value: '5', confidence: 'HIGH' }]),
    ] }],
  };
  const facts = aggregateTasTechnicalFacts(browserOfficial);
  const floors = facts.find((f) => f.key === 'floors');
  assert.equal(floors.block, null, 'a different document\'s block must never leak onto this one');
});

test('aggregateTasTechnicalFacts: the same field reported for two different named blocks is kept as two distinct entries, never collapsed', () => {
  const browserOfficial = {
    results: [{ source: 'tas', documents: [
      doc('u1', 'Permit Block A', '2023-01-01', [
        { category: 'PROJECT', key: 'buildingBlock', value: 'A', confidence: 'HIGH' },
        { category: 'PROJECT', key: 'floors', value: '9', confidence: 'HIGH' },
      ]),
      doc('u2', 'Permit Block B', '2023-01-01', [
        { category: 'PROJECT', key: 'buildingBlock', value: 'B', confidence: 'HIGH' },
        { category: 'PROJECT', key: 'floors', value: '12', confidence: 'HIGH' },
      ]),
    ] }],
  };
  const facts = aggregateTasTechnicalFacts(browserOfficial).filter((f) => f.key === 'floors');
  assert.equal(facts.length, 2);
  assert.deepEqual(new Set(facts.map((f) => f.block)), new Set(['A', 'B']));
});

test('buildRevisionTimeline: a revised value between an old and a new permit produces a two-entry chronological timeline, oldest first', () => {
  const facts = [
    { category: 'PROJECT', key: 'floors', value: '8', documentTitle: 'Permit v1', documentDate: '2022-05-01', block: null },
    { category: 'PROJECT', key: 'floors', value: '9', documentTitle: 'Permit v2', documentDate: '2023-11-01', block: null },
  ];
  const timeline = buildRevisionTimeline(facts);
  assert.ok(timeline);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].documentDate, '2022-05-01');
  assert.equal(timeline[1].documentDate, '2023-11-01');
});

test('buildRevisionTimeline: only ONE document (or several with no distinct dates) never produces a fabricated single-entry timeline — returns null', () => {
  assert.equal(buildRevisionTimeline([{ category: 'PROJECT', key: 'floors', value: '9', documentTitle: 'Permit v1', documentDate: '2022-05-01', block: null }]), null);
  assert.equal(buildRevisionTimeline([
    { category: 'PROJECT', key: 'floors', value: '9', documentTitle: 'Permit A', documentDate: null, block: null },
    { category: 'PROJECT', key: 'height', value: '30m', documentTitle: 'Permit B', documentDate: null, block: null },
  ]), null);
});

test('buildRevisionTimeline: undated documents are kept at the end rather than sorted arbitrarily among dated ones', () => {
  const facts = [
    { category: 'PROJECT', key: 'floors', value: '9', documentTitle: 'Permit v2', documentDate: '2023-11-01', block: null },
    { category: 'PROJECT', key: 'height', value: '30m', documentTitle: 'Undated permit', documentDate: null, block: null },
    { category: 'PROJECT', key: 'floors', value: '8', documentTitle: 'Permit v1', documentDate: '2022-05-01', block: null },
  ];
  const timeline = buildRevisionTimeline(facts);
  assert.deepEqual(timeline.map((g) => g.documentTitle), ['Permit v1', 'Permit v2', 'Undated permit']);
});
