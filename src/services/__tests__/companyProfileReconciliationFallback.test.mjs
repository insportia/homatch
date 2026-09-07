// Pure-logic regression test for supabase/functions/research-agent/index.ts's
// finish() SYNTHESIS branch: the companyProfile reconciliation fallback
// (2026-09-07 Verify mandate — "market/public evidence can know [a
// developer] while top-level projectProfile remains blank"). projectProfile
// already merged in reconciledIdentity (v25); companyProfile had the same
// gap for the terminal case where a developer reconciliation promotes to
// MEDIUM/HIGH confidence but no ENREG/model-reported companyProfile object
// ever materialized (a genuine NO_RESULT_CONFIRMED ENREG search, or the
// lookup never firing). That file is a Deno edge function and can't be
// imported directly here (see tasTechnicalFactsAggregation.test.mjs in this
// same directory for why) — the pure logic is copied verbatim. Keep this in
// sync with research-agent/index.ts's own companyProfileSourceBasis() and
// the rawCompanyProfile fallback block in finish() whenever that changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function normalizeLoose(s) {
  return String(s || '').toLowerCase().replace(/["'«»„"]/g, '').replace(/\s+/g, ' ').trim();
}
function companyProfileSourceBasis(companyProfile, browserOfficial) {
  if (!companyProfile || (!companyProfile.name && !companyProfile.idCode)) return 'WEB_RESEARCH_ONLY';
  const results = browserOfficial?.results || [];
  const match = results.find((r) => {
    if (r.source !== 'enreg' || r.status !== 'SEARCH_CONFIRMED') return false;
    const forId = r.forEntity?.idCode || null;
    const forName = r.forEntity?.name || null;
    if (companyProfile.idCode && forId) return forId === companyProfile.idCode;
    if (!forId && forName) return normalizeLoose(forName) === normalizeLoose(companyProfile.name || '');
    if (!r.forEntity && companyProfile.idCode) return true;
    return false;
  });
  if (!match) return 'WEB_RESEARCH_ONLY';
  return (match.documents || []).some((d) => d.parsed) ? 'REGISTRY_CONFIRMED' : 'WEB_RESEARCH_ONLY';
}
// The exact fallback block from finish()'s SYNTHESIS branch.
function resolveCompanyProfile(z, o, reconciledIdentity, browserOfficial) {
  let rawCompanyProfile = z.companyProfile || o.companyProfile || null;
  if ((!rawCompanyProfile || !(rawCompanyProfile.name || rawCompanyProfile.idCode)) && reconciledIdentity?.developer && ['MEDIUM', 'HIGH'].includes(reconciledIdentity.confidence)) {
    rawCompanyProfile = { name: reconciledIdentity.developer, idCode: null, legalForm: null, registrationDate: null, status: null, directors: [], representatives: [], historicalChanges: [], relatedProjects: [], summary: null, reconciledFromMarketEvidence: true };
  }
  return rawCompanyProfile ? { ...rawCompanyProfile, sourceBasis: companyProfileSourceBasis(rawCompanyProfile, browserOfficial) } : null;
}

test('resolveCompanyProfile: the exact mandate scenario — market/public evidence reconciled a developer at HIGH confidence, but no ENREG/model companyProfile ever materialized (a foreign or informally-named developer, generic fixture name)', () => {
  const reconciledIdentity = { developer: 'Example Development Group', confidence: 'HIGH', project: 'Example Towers', address: 'Example St 6' };
  const cp = resolveCompanyProfile({}, {}, reconciledIdentity, { results: [] });
  assert.ok(cp, 'companyProfile must not stay null when a developer was reconciled at HIGH confidence');
  assert.equal(cp.name, 'Example Development Group');
  assert.equal(cp.sourceBasis, 'WEB_RESEARCH_ONLY', 'never presented as registry-confirmed when it was never registry-matched');
  assert.equal(cp.reconciledFromMarketEvidence, true, 'must be distinguishable from a genuinely model/ENREG-produced profile');
});

test('resolveCompanyProfile: an existing SYNTHESIS or OFFICIAL companyProfile is never overridden or discarded by the reconciliation fallback', () => {
  const z = { companyProfile: { name: 'Real Registry Co', idCode: '405999888' } };
  const reconciledIdentity = { developer: 'A Different Name Entirely', confidence: 'HIGH' };
  const cp = resolveCompanyProfile(z, {}, reconciledIdentity, { results: [] });
  assert.equal(cp.name, 'Real Registry Co', 'a real companyProfile the model/OFFICIAL already produced always wins');
  assert.equal(cp.idCode, '405999888');
});

test('resolveCompanyProfile: a LOW-confidence reconciliation (single unconfirmed mention) must never populate companyProfile — same confidence floor as pickFinancialCandidate\'s own ENREG-trigger rule', () => {
  const reconciledIdentity = { developer: 'Some Unconfirmed Name', confidence: 'LOW' };
  const cp = resolveCompanyProfile({}, {}, reconciledIdentity, { results: [] });
  assert.equal(cp, null);
});

test('resolveCompanyProfile: no reconciled developer at all and nothing from SYNTHESIS/OFFICIAL -> null, never a fabricated stub', () => {
  assert.equal(resolveCompanyProfile({}, {}, null, { results: [] }), null);
  assert.equal(resolveCompanyProfile({}, {}, { developer: null, confidence: 'HIGH' }, { results: [] }), null);
});

test('resolveCompanyProfile: when an ENREG SEARCH_CONFIRMED result for this exact reconciled developer name genuinely exists with a parsed document, sourceBasis correctly upgrades to REGISTRY_CONFIRMED even though this fallback path built the base object', () => {
  const reconciledIdentity = { developer: 'Registry Matched Co', confidence: 'MEDIUM' };
  const browserOfficial = { results: [{ source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: { name: 'Registry Matched Co' }, documents: [{ parsed: true }] }] };
  const cp = resolveCompanyProfile({}, {}, reconciledIdentity, browserOfficial);
  assert.equal(cp.sourceBasis, 'REGISTRY_CONFIRMED');
});
