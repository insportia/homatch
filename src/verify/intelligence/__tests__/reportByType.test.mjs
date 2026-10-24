// reportByType.test.mjs — the report is written for the property's type (owner 2026-10-24): a land plot is a study of
// the plot and its surroundings, a house of the house and its plot, a commercial space or office of its business case;
// the new-build apartment rules apply only to an apartment in a developer's project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reportStudyFor, sectionClassFor, analystRulesFor, buildIntelligencePrompt } from '../prompt.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const pkg = buildEvidencePackage({});
const NEW_BUILD = /A BANK MORTGAGE ON A NEW-BUILD APARTMENT|QUALITY IS ASSESSED HONESTLY|TELL THE STORY\. The buyer should finish the report knowing this project/;

test('the registry kind decides the study; the declared class only fills in', () => {
  assert.equal(reportStudyFor('LAND', 'NEW_BUILD'), 'LAND', 'a registry plot is a plot whatever was declared');
  assert.equal(reportStudyFor('UNKNOWN', 'LAND'), 'LAND');
  assert.equal(reportStudyFor('PRIVATE_HOUSE', 'COMPANY_OWNED'), 'HOUSE');
  assert.equal(reportStudyFor('OFFICE', null), 'OFFICE');
  assert.equal(reportStudyFor('COMMERCIAL', null), 'COMMERCIAL');
  assert.equal(reportStudyFor('APARTMENT', 'PRIVATE_RESALE'), 'RESALE_APARTMENT');
  assert.equal(reportStudyFor('APARTMENT', null), 'PROJECT');
  assert.equal(reportStudyFor('PARKING', 'PRIVATE_RESALE'), 'PROJECT', 'parking keeps its own kind rule');
  assert.equal(reportStudyFor(null, null), 'PROJECT');
  assert.equal(sectionClassFor('LAND', 'NEW_BUILD'), 'LAND');
  assert.equal(sectionClassFor('PROJECT', 'NEW_BUILD'), 'NEW_BUILD');
});

test('a project report is unchanged; every other type loses the new-build blocks and gets its own outline', () => {
  const project = analystRulesFor('PROJECT').join('\n');
  assert.match(project, NEW_BUILD);
  assert.match(project, /MARKET IS A REAL MARKET STUDY/);
  const outlines = {
    LAND: /STUDY OF THE PLOT AND EVERYTHING AROUND IT[\s\S]*THE SURROUNDINGS[\s\S]*THE LAND MARKET/,
    HOUSE: /STUDY OF THE HOUSE, ITS PLOT AND ITS STREET[\s\S]*THE HOUSE MARKET/,
    COMMERCIAL: /STUDY OF A BUSINESS PROPERTY[\s\S]*sale AND rent comparables/,
    OFFICE: /STUDY OF AN OFFICE[\s\S]*THE OFFICE MARKET/,
    RESALE_APARTMENT: /THIS IS A RESALE[\s\S]*REGISTER HISTORY/,
  };
  for (const [study, outline] of Object.entries(outlines)) {
    const rules = analystRulesFor(study).join('\n');
    assert.doesNotMatch(rules, NEW_BUILD, study);
    assert.match(rules, outline, study);
    assert.match(rules, /^SUBJECT TYPE: /, study);
    assert.match(rules, /A BANK MORTGAGE IS A NORMAL, COMMON FACT/, study);
    assert.match(rules, /WHAT WE DO NOT HAVE IS NOT WRITTEN/, `${study} keeps the shared rules`);
  }
  assert.doesNotMatch(analystRulesFor('LAND').join('\n'), /MARKET IS A REAL MARKET STUDY/, 'a plot never gets the apartment market brief');
  assert.match(analystRulesFor('RESALE_APARTMENT').join('\n'), /MARKET IS A REAL MARKET STUDY/, 'a resale apartment keeps it');
});

test('a registry plot gets land sections and its land facts, even when a project class was declared', () => {
  const { system, user } = buildIntelligencePrompt(pkg, undefined, 'NEW_BUILD', { propertyKind: { kind: 'LAND', basis: [{ source: 'EXTRACT_STRUCTURE', text: 'parcel-only extract' }], conflicts: [] }, landProfile: { permittedUse: 'non-agricultural' } });
  assert.doesNotMatch(system, NEW_BUILD);
  assert.match(system, /STUDY OF THE PLOT/);
  assert.doesNotMatch(system.split('"sections"')[1].split('\n')[0], /PROJECT\|/, 'no PROJECT section for a plot');
  const u = JSON.parse(user);
  assert.equal(u.reportStudy, 'LAND');
  assert.equal(u.landProfile.permittedUse, 'non-agricultural');
  const apt = JSON.parse(buildIntelligencePrompt(pkg, undefined, null, { landProfile: { permittedUse: 'x' } }).user);
  assert.equal(apt.landProfile, undefined, 'land facts only for land and houses');
});

test('verify-synthesis hands the plot facts to the prompt', () => {
  const vs = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/verify-synthesis/index.ts', import.meta.url)), 'utf8');
  assert.match(vs, /propertyKind: subjectKind,\n\s+landProfile: rj\?\.landProfile \?\? null,/);
});
