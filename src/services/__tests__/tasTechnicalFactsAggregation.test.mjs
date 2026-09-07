// Pure-logic regression test for supabase/functions/research-agent/index.ts's
// aggregateTasTechnicalFacts()/formatTasTechnicalFactsForPrompt() (2026-09-07
// TAS DOCUMENT INTELLIGENCE mandate). That file is a Deno edge function (jsr:
// imports, no local Deno runtime/type-checker available in this environment
// — see the session's own build-tooling notes), so it can't be imported
// directly here. Following this repo's own established pattern (see
// verifyHistoryFilter.test.mjs in this same directory), the pure logic is
// copied verbatim and exercised directly. Keep this in sync with
// research-agent/index.ts's own aggregateTasTechnicalFacts/
// formatTasTechnicalFactsForPrompt whenever that logic changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function aggregateTasTechnicalFacts(browserOfficial) {
  const out = [];
  for (const r of browserOfficial?.results || []) {
    for (const d of r.documents || []) {
      const facts = Array.isArray(d.technicalFacts) ? d.technicalFacts : [];
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
        });
      }
    }
  }
  const byId = new Map();
  for (const f of out) {
    const id = `${f.category}::${f.key}::${f.value}`;
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
function formatTasTechnicalFactsForPrompt(facts) {
  if (!facts.length) return '';
  const byCategory = new Map();
  for (const f of facts) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  }
  const lines = [];
  for (const [cat, items] of byCategory) {
    lines.push(`${cat}: ` + items.map((f) => `${f.key}=${f.value}${f.documentDate ? ` (doc dated ${f.documentDate})` : ''}`).join('; '));
  }
  return lines.join('\n');
}

test('aggregateTasTechnicalFacts: no browserOfficial / no documents / no technicalFacts anywhere -> []', () => {
  assert.deepEqual(aggregateTasTechnicalFacts(null), []);
  assert.deepEqual(aggregateTasTechnicalFacts({}), []);
  assert.deepEqual(aggregateTasTechnicalFacts({ results: [{ documents: [{ url: 'x' }] }] }), []);
});

test('aggregateTasTechnicalFacts: collects facts across multiple documents/sources, generic — no project-specific assumptions', () => {
  const browserOfficial = {
    results: [
      {
        source: 'tas',
        documents: [
          { url: 'https://tas.ge/d1', title: 'Doc 1', date: '2020-01-01', technicalFacts: [{ category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო ხაზარაძე', confidence: 'HIGH' }] },
        ],
      },
      {
        source: 'enreg',
        documents: [{ url: 'https://enreg.ge/d2', label: 'Doc 2', technicalFacts: [{ category: 'FOUNDATION', key: 'piles', value: '45', confidence: 'HIGH' }] }],
      },
    ],
  };
  const facts = aggregateTasTechnicalFacts(browserOfficial);
  assert.equal(facts.length, 2);
  const arch = facts.find((f) => f.key === 'mainArchitectName');
  assert.equal(arch.documentUrl, 'https://tas.ge/d1');
  assert.equal(arch.documentTitle, 'Doc 1');
  const piles = facts.find((f) => f.key === 'piles');
  assert.equal(piles.documentTitle, 'Doc 2', 'falls back to label when a document has no .title');
});

test('aggregateTasTechnicalFacts: an exact-repeat fact across two documents dedupes to one entry, keeping the HIGH-confidence occurrence', () => {
  const browserOfficial = {
    results: [
      {
        documents: [
          { url: 'https://x/d1', technicalFacts: [{ category: 'ARCHITECT', key: 'mainArchitectName', value: 'დავით მჭედლიშვილი', confidence: 'MEDIUM' }] },
          { url: 'https://x/d2', technicalFacts: [{ category: 'ARCHITECT', key: 'mainArchitectName', value: 'დავით მჭედლიშვილი', confidence: 'HIGH' }] },
        ],
      },
    ],
  };
  const facts = aggregateTasTechnicalFacts(browserOfficial);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].confidence, 'HIGH');
});

test('aggregateTasTechnicalFacts: genuinely DIFFERENT values for the same category+key (e.g. a revised floor count) are both kept — this function never picks a single winner', () => {
  const browserOfficial = {
    results: [
      {
        documents: [
          { url: 'https://x/old', date: '2019-01-01', technicalFacts: [{ category: 'PROJECT', key: 'floors', value: '5', confidence: 'HIGH' }] },
          { url: 'https://x/new', date: '2023-01-01', technicalFacts: [{ category: 'PROJECT', key: 'floors', value: '7', confidence: 'HIGH' }] },
        ],
      },
    ],
  };
  const facts = aggregateTasTechnicalFacts(browserOfficial);
  assert.equal(facts.filter((f) => f.key === 'floors').length, 2, 'picking the latest/approved revision is a separate concern, not this aggregator\'s job');
});

test('aggregateTasTechnicalFacts: a malformed fact entry (missing category/key/value) is silently skipped, never crashes or fabricates a partial fact', () => {
  const browserOfficial = { results: [{ documents: [{ url: 'x', technicalFacts: [{ category: 'ARCHITECT' }, null, { key: 'onlyKey', value: 'v' }] }] }] };
  assert.deepEqual(aggregateTasTechnicalFacts(browserOfficial), []);
});

test('formatTasTechnicalFactsForPrompt: empty input -> empty string (caller uses this to omit the whole prompt block)', () => {
  assert.equal(formatTasTechnicalFactsForPrompt([]), '');
});

test('formatTasTechnicalFactsForPrompt: groups by category, one line per category, includes the document date when known', () => {
  const facts = [
    { category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო ხაზარაძე', documentDate: '2021-05-01' },
    { category: 'FOUNDATION', key: 'piles', value: '45', documentDate: null },
    { category: 'FOUNDATION', key: 'foundationType', value: 'ზოლური საძირკველი', documentDate: null },
  ];
  const out = formatTasTechnicalFactsForPrompt(facts);
  const lines = out.split('\n');
  assert.equal(lines.length, 2, 'one line per category, not per fact');
  const archLine = lines.find((l) => l.startsWith('ARCHITECT:'));
  assert.ok(archLine.includes('mainArchitectName=ნინო ხაზარაძე'));
  assert.ok(archLine.includes('(doc dated 2021-05-01)'));
  const foundationLine = lines.find((l) => l.startsWith('FOUNDATION:'));
  assert.ok(foundationLine.includes('piles=45'));
  assert.ok(foundationLine.includes('foundationType=ზოლური საძირკველი'));
});
