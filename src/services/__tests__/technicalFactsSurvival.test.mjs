// Pure-logic regression test for the 2026-09-07 gap fix: "TAS technical
// facts as PRIMARY evidence... must survive all the way to synthesis AND
// UI." Before this fix, aggregateTasTechnicalFacts() output only ever
// reached the SYNTHESIS prompt as guidance text (see prompt()'s "TAS/
// OFFICIAL DOCUMENT TECHNICAL FACTS ALREADY CONFIRMED" block) — whether a
// specific confirmed fact actually appeared anywhere in the final report
// depended entirely on the SYNTHESIS model choosing to mention it in
// prose. officialDocuments() (the customer-facing document list) never
// carried per-document technicalFacts through either. This tests the two
// pure functions (both in supabase/functions/research-agent/index.ts and
// src/pages/VerifyPage.tsx) that now expose the same deterministic facts
// as their own guaranteed report field, plus the frontend's
// category-grouping logic. Copied verbatim per this repo's established
// pattern (a Deno edge function and a .tsx file this sandbox cannot
// import directly) — keep all three in sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- copied verbatim from supabase/functions/research-agent/index.ts's
// finish() SYNTHESIS branch (the `technicalFacts` computation) ---
function toCustomerTechnicalFacts(tasTechnicalFacts) {
  const technicalFacts = (Array.isArray(tasTechnicalFacts) ? tasTechnicalFacts : []).map((f) => ({ category: f.category, key: f.key, value: f.value, confidence: f.confidence, documentTitle: f.documentTitle || null, documentDate: f.documentDate || null }));
  return technicalFacts.length ? technicalFacts : null;
}

// --- copied verbatim from src/pages/VerifyPage.tsx's TechnicalFactsCard ---
function groupTechnicalFactsByCategory(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const byCategory = new Map();
  for (const f of list) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category).push(f);
  }
  return Array.from(byCategory.entries());
}

test('toCustomerTechnicalFacts: a confirmed TAS technical fact is guaranteed to reach the report field, independent of anything the SYNTHESIS model writes', () => {
  const aggregated = [{ category: 'STRUCTURAL', key: 'floors', value: '9', confidence: 'HIGH', documentUrl: 'https://tas.ge/doc/123', documentTitle: 'Construction permit', documentDate: '2024-03-01' }];
  const result = toCustomerTechnicalFacts(aggregated);
  assert.deepEqual(result, [{ category: 'STRUCTURAL', key: 'floors', value: '9', confidence: 'HIGH', documentTitle: 'Construction permit', documentDate: '2024-03-01' }]);
});

test('toCustomerTechnicalFacts: no document URL is ever included, consistent with the established "comparables/sources never render url to the customer" policy', () => {
  const result = toCustomerTechnicalFacts([{ category: 'IDENTITY', key: 'applicant', value: 'Jane Doe', confidence: 'MEDIUM', documentUrl: 'https://enreg.reestri.gov.ge/secret-doc', documentTitle: null, documentDate: null }]);
  assert.equal('documentUrl' in result[0], false);
  assert.equal(JSON.stringify(result).includes('reestri.gov.ge'), false);
});

test('toCustomerTechnicalFacts: no facts at all -> null (not an empty array), matching this schema\'s "null means no evidence" convention', () => {
  assert.equal(toCustomerTechnicalFacts([]), null);
  assert.equal(toCustomerTechnicalFacts(undefined), null);
  assert.equal(toCustomerTechnicalFacts(null), null);
});

test('groupTechnicalFactsByCategory: facts group under their category, preserving within-category order, for the report\'s per-category rendering', () => {
  const facts = [
    { category: 'STRUCTURAL', key: 'floors', value: '9' },
    { category: 'IDENTITY', key: 'applicant', value: 'Jane Doe' },
    { category: 'STRUCTURAL', key: 'foundation', value: 'pile' },
  ];
  const groups = groupTechnicalFactsByCategory(facts);
  assert.deepEqual(groups.map(([cat]) => cat), ['STRUCTURAL', 'IDENTITY'], 'categories appear in first-seen order');
  assert.deepEqual(groups.find(([cat]) => cat === 'STRUCTURAL')[1].map((f) => f.key), ['floors', 'foundation']);
});

test('groupTechnicalFactsByCategory: an empty/null facts list produces zero groups (TechnicalFactsCard must render nothing)', () => {
  assert.deepEqual(groupTechnicalFactsByCategory([]), []);
  assert.deepEqual(groupTechnicalFactsByCategory(null), []);
});
