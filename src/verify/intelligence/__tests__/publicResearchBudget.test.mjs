import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactOfficialContext, OFFICIAL_CONTEXT_BUDGET } from '../officialContext.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * THE LANE BOUNDARY THAT REPAIRING ANOTHER LANE BROKE.
 *
 * Villion 01.18.06.019.055.03.01.601, two real runs:
 *
 *   e1b5d95c  official results 0   nearbyPlaces 6   publicResearch facts 8
 *   347f9933  official results 4   nearbyPlaces 0   publicResearch facts 5
 *
 * Nothing about location changed between them. What changed is that the
 * official worker started succeeding, and PUBLIC_RESEARCH was being handed
 * `Official=${JSON.stringify(o).slice(0, 12000)}` — raw registry documents —
 * inside a prompt whose single response carries roughly forty fields. The
 * optional fields went first and location intelligence vanished entirely.
 *
 * The stage now receives a compact identity summary under a hard budget.
 * These tests hold that boundary, because the failure mode is silent: nobody
 * notices a field that stopped being returned.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.resolve(here, '../../../../supabase/functions/research-agent/index.ts'),
  'utf8'
);

const REAL_OFFICIAL = {
  companyProfile: {
    name: 'შპს მილენიო გრუპი',
    idCode: '404670272',
    registeredAddress: 'საქართველო, თბილისი, კრწანისის რაიონი, კრწანისის ქუჩა, N6',
    directors: [{ name: 'კობა კვანტალიანი', representation: 'ერთობლივი' }],
    shareholders: [{ name: 'ლევან ჩაჩუა', percentage: 50 }],
    // The part that must NOT travel into the public lane.
    extractRawText: 'ა'.repeat(9000),
  },
  exactUnit: {
    code: '01.18.06.019.055.03.01.601',
    address: 'კრწანისის ქუჩა 6, თბილისი',
    propertyType: 'ბინა', area: '94.3', rooms: '3', floor: '6',
  },
  documents: Array.from({ length: 4 }, (_, i) => ({ rawText: 'ბ'.repeat(4000), url: `doc-${i}` })),
};

test('the public lane never receives the raw official payload', () => {
  // The literal that caused the regression must not come back.
  assert.equal(
    /Official=\$\{JSON\.stringify\(o\)\.slice\(0, ?12000\)\}/.test(SRC), false,
    'the raw 12k official blob must not be injected into PUBLIC_RESEARCH'
  );
  assert.match(SRC, /OfficialContext=\$\{compactOfficialContext\(o\)\}/);
});

test('the compact context stays inside its budget on a real official payload', () => {
  const out = compactOfficialContext(REAL_OFFICIAL);

  assert.ok(out.length > 0, 'the summary must not be empty');
  assert.ok(
    out.length <= OFFICIAL_CONTEXT_BUDGET,
    `summary is ${out.length} chars, over the ${OFFICIAL_CONTEXT_BUDGET} budget`
  );
  // Raw document text — 25,000 characters of it — must be nowhere near it.
  assert.equal(out.includes('ა'.repeat(200)), false, 'extract text must not leak into the lane');
  assert.equal(out.includes('ბ'.repeat(200)), false, 'document text must not leak into the lane');
  assert.ok(out.length < JSON.stringify(REAL_OFFICIAL).length / 20, 'it must be a summary, not a slice');
});

test('it carries exactly what the lane needs to search and disambiguate', () => {
  const out = compactOfficialContext(REAL_OFFICIAL);
  for (const needed of [
    '01.18.06.019.055.03.01.601',   // the subject
    'კრწანისის ქუჩა 6',             // where to search
    'შპს მილენიო გრუპი',            // who built it
    '404670272',                    // and which company that is
  ]) {
    assert.ok(out.includes(needed), `the lane needs ${needed} to search accurately`);
  }
});

test('an official payload that grows cannot silently consume the lane again', () => {
  // Every field absurdly long — the shape of "official evidence grew".
  const huge = {
    companyProfile: { name: 'ა'.repeat(5000), idCode: 'ბ'.repeat(5000), registeredAddress: 'გ'.repeat(5000) },
    exactUnit: { code: 'დ'.repeat(5000), address: 'ე'.repeat(5000), propertyType: 'ვ'.repeat(5000) },
  };
  const out = compactOfficialContext(huge);
  assert.ok(
    out.length <= OFFICIAL_CONTEXT_BUDGET,
    `budget breached: ${out.length} > ${OFFICIAL_CONTEXT_BUDGET}`
  );
});

test('an empty or absent official lane produces an empty context, never a crash', () => {
  for (const input of [null, undefined, {}, { companyProfile: null }]) {
    assert.equal(typeof compactOfficialContext(input), 'string');
  }
});

test('the full official evidence is still authoritative downstream', () => {
  // The compaction is a PROMPT boundary only. Nothing may delete or rewrite
  // the stored official evidence that later stages read.
  const MODULE = fs.readFileSync(path.resolve(here, '../officialContext.ts'), 'utf8');
  const fn = MODULE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['delete ', '.update(', 'result_json =']) {
    assert.equal(fn.includes(forbidden), false, `the summary must not mutate state (${forbidden})`);
  }
});
