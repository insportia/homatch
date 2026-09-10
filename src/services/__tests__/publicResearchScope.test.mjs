// Regression test for the PUBLIC_RESEARCH plan: it must genuinely differ by
// asset class, so a private resale, a land parcel or a house is never forced
// through developer/architect/contractor research it has no reason to want.
//
// This file used to carry a verbatim COPY of publicResearchScope() under a
// "keep this in sync with research-agent/index.ts" comment, because that file
// is a Deno edge function. A copy proves a copy adapts. The logic now lives
// in src/verify/researchPlan.ts, which the edge function imports, so these
// assertions run against the code that actually ships and the two can no
// longer drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_RESEARCH_TARGETS, publicResearchScope } from '../../verify/researchPlan.ts';

test('publicResearchScope: development-project apartment (APARTMENT_IN_PROJECT) gets the full, unnarrowed target list and no scope note — developer/architect research is genuinely expected here', () => {
  const scope = publicResearchScope('APARTMENT_IN_PROJECT');
  assert.deepEqual(scope.targets, PUBLIC_RESEARCH_TARGETS);
  assert.equal(scope.scopeNote, '');
  assert.ok(scope.targets.includes('architect'));
  assert.ok(scope.targets.includes('contractors'));
});

test('publicResearchScope: private resale apartment (PRIVATE_RESALE) drops developer/architect/contractor targets and says so explicitly', () => {
  const scope = publicResearchScope('PRIVATE_RESALE');
  assert.equal(scope.targets.includes('architect'), false);
  assert.equal(scope.targets.includes('contractors'), false);
  assert.equal(scope.targets.includes('founders owners participants'), false);
  assert.ok(scope.scopeNote.includes('Do NOT go looking for a developer'));
});

test('publicResearchScope: land parcel (LAND) drops every building-fabric target', () => {
  const scope = publicResearchScope('LAND');
  for (const t of ['facade', 'windows', 'elevators', 'structural system', 'insulation', 'MEP (mechanical/electrical/plumbing)', 'seismic design', 'amenities', 'landscaping', 'parking']) {
    assert.equal(scope.targets.includes(t), false, `LAND scope must not include building-fabric target "${t}"`);
  }
  assert.ok(scope.scopeNote.includes('bare land parcel'));
});

test('publicResearchScope: detached house (PRIVATE_HOUSE) also drops forced developer research, distinct wording from PRIVATE_RESALE', () => {
  const scope = publicResearchScope('PRIVATE_HOUSE');
  assert.equal(scope.targets.includes('architect'), false);
  assert.ok(scope.scopeNote.includes('standalone private house'));
  assert.notEqual(scope.scopeNote, publicResearchScope('PRIVATE_RESALE').scopeNote);
});

test('publicResearchScope: commercial property (COMMERCIAL) keeps construction/developer/reputation targets but reframes amenities in commercial terms via its scope note', () => {
  const scope = publicResearchScope('COMMERCIAL');
  assert.ok(scope.targets.includes('architect'));
  assert.ok(scope.targets.includes('contractors'));
  assert.ok(scope.targets.includes('amenities'));
  assert.ok(scope.scopeNote.includes('commercial terms'));
});

test('publicResearchScope: an unset/unrecognized assetClass (MIXED_OR_UNKNOWN, null, undefined, a typo) safely falls back to the full unnarrowed list — never silently drops evidence when the class is genuinely unclear', () => {
  assert.deepEqual(publicResearchScope('MIXED_OR_UNKNOWN').targets, PUBLIC_RESEARCH_TARGETS);
  assert.deepEqual(publicResearchScope(null).targets, PUBLIC_RESEARCH_TARGETS);
  assert.deepEqual(publicResearchScope(undefined).targets, PUBLIC_RESEARCH_TARGETS);
  assert.deepEqual(publicResearchScope('SOME_FUTURE_VALUE').targets, PUBLIC_RESEARCH_TARGETS);
});

test('publicResearchScope: the 3 asset classes with no forced developer/building research (private resale, land, private house) each produce a genuinely narrower, mutually distinct target list from the full-breadth default and from each other', () => {
  const fullBreadth = JSON.stringify(publicResearchScope('APARTMENT_IN_PROJECT').targets.slice().sort());
  const narrow = { PRIVATE_RESALE: publicResearchScope('PRIVATE_RESALE'), LAND: publicResearchScope('LAND'), PRIVATE_HOUSE: publicResearchScope('PRIVATE_HOUSE') };
  const serialized = Object.fromEntries(Object.entries(narrow).map(([k, v]) => [k, JSON.stringify(v.targets.slice().sort())]));
  for (const [name, s] of Object.entries(serialized)) {
    assert.ok(s.length < fullBreadth.length, `${name}'s target list should be strictly narrower than the full-breadth default`);
    assert.notEqual(s, fullBreadth, `${name} must not silently fall back to the full-breadth list`);
  }
  const distinctNarrow = new Set(Object.values(serialized));
  assert.equal(distinctNarrow.size, 3, 'the 3 narrow scenarios should still differ from each other, not collapse into one generic "private property" list');
  // Commercial legitimately researches the same breadth as a development
  // project (a commercial building still has facade/MEP/contractors/etc.)
  // — only its FRAMING differs (see the scope note test above), so it is
  // correctly excluded from the "narrower" set here.
});
