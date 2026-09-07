// Pure-logic regression test for supabase/functions/research-agent/index.ts's
// publicResearchScope() (2026-09-07 "IMPORTANT GENERALIZATION RULE" mandate
// addendum: the research plan must genuinely differ by asset class, and a
// private resale/land/house must never be forced through developer/
// architect/contractor research). That file is a Deno edge function and
// can't be imported directly here (see tasTechnicalFactsAggregation.test.mjs
// in this same directory for why) — the pure logic is copied verbatim.
// Keep this in sync with research-agent/index.ts's own publicResearchScope/
// PUBLIC_RESEARCH_TARGETS whenever that logic changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PUBLIC_RESEARCH_TARGETS = [
  'architect', 'architecture studio', 'founders owners participants', 'directors representatives', 'company history',
  'previous projects', 'contractors', 'construction companies', 'engineers', 'suppliers', 'facade', 'windows',
  'elevators', 'structural system', 'construction materials', 'insulation', 'MEP (mechanical/electrical/plumbing)',
  'energy efficiency', 'seismic design', 'amenities', 'landscaping', 'parking', 'bank financing', 'partners',
  'construction start', 'construction chronology', 'progress history', 'current physical status', 'quality',
  'developer reputation', 'architect reputation', 'complaints', 'disputes', 'court records', 'media coverage',
  'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'TikTok', 'Telegram', 'forums', 'reviews',
];
function publicResearchScope(assetClass) {
  const buildingTargets = ['facade', 'windows', 'elevators', 'structural system', 'construction materials', 'insulation', 'MEP (mechanical/electrical/plumbing)', 'energy efficiency', 'seismic design', 'amenities', 'landscaping', 'parking'];
  const developerTargets = ['founders owners participants', 'directors representatives', 'company history', 'previous projects', 'developer reputation', 'bank financing', 'partners'];
  const constructionTeamTargets = ['architect', 'architecture studio', 'architect reputation', 'contractors', 'construction companies', 'engineers', 'suppliers', 'construction start', 'construction chronology', 'progress history', 'current physical status', 'quality'];
  const reputationTargets = ['complaints', 'disputes', 'court records', 'media coverage', 'Facebook', 'Instagram', 'LinkedIn', 'YouTube', 'TikTok', 'Telegram', 'forums', 'reviews'];
  switch (assetClass) {
    case 'PRIVATE_RESALE':
    case 'RENTAL':
      return { targets: [...reputationTargets, 'quality'], scopeNote: 'ASSET-CLASS SCOPE (private resale/rental — no forced developer research): this is a private individual\'s unit, not a marketed development project. Do NOT go looking for a developer, architect, contractor, or construction-company just to fill those fields — only research and populate them if the evidence already gathered (Identity/Official above) actually names one for this exact unit/building. It is entirely normal and CORRECT for developer/architect/contractor/companyHistory/previousProjects fields to stay null here; never invent a plausible-sounding value to avoid an empty field. Focus your search instead on: the property\'s own public reputation/reviews, its immediate micro-location, and any publicly reported quality signals or complaints about this exact address/unit.' };
    case 'PRIVATE_HOUSE':
      return { targets: ['quality', 'current physical status', ...reputationTargets], scopeNote: 'ASSET-CLASS SCOPE (private house — no forced developer/project research): this is a standalone private house, not a unit in a marketed development. Only populate developer/architect/contractor/companyHistory/previousProjects if the evidence already gathered actually names one (e.g. a custom-build architect/builder is sometimes publicly documented) — otherwise leave them null; that is the expected, correct outcome, not a gap. Focus your search on the property\'s own public reputation and its immediate micro-location.' };
    case 'LAND':
      return { targets: ['previous projects', 'developer reputation', 'quality', 'current physical status', ...reputationTargets], scopeNote: 'ASSET-CLASS SCOPE (land parcel — no building-fabric research applies): this is a bare land parcel, not a building or unit. Facade/windows/elevators/structural system/construction materials/insulation/MEP/energy efficiency/seismic design/amenities/landscaping-as-a-building-feature/parking simply do not apply — leave every one of those fields null rather than describing the parcel\'s physical state under them. If a developer or project already publicly plans to build on this exact parcel, that is worth reporting (developer/previousProjects/companyHistory) — but never invent one. Focus your search on how this parcel and its immediate area are publicly discussed (development plans, land use, reputation of any named developer).' };
    case 'COMMERCIAL':
      return { targets: [...constructionTeamTargets, ...buildingTargets, ...developerTargets, ...reputationTargets], scopeNote: 'ASSET-CLASS SCOPE (commercial property): research the same construction/developer/reputation topics as a residential project, but frame amenities/landscaping/parking findings in commercial terms (tenant/business-facing features, accessibility, signage/visibility) rather than residential ones — only when the evidence actually supports it.' };
    case 'APARTMENT_IN_PROJECT':
    case 'UNDER_CONSTRUCTION':
    case 'COMPANY_OWNED':
    case 'MIXED_OR_UNKNOWN':
    default:
      return { targets: PUBLIC_RESEARCH_TARGETS, scopeNote: '' };
  }
}

// The 5 scenarios the mandate explicitly requires coverage for: development-
// project apartment, private resale apartment, land parcel, detached house,
// commercial property.

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
