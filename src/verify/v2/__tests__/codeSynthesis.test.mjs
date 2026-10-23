// codeSynthesis.test.mjs — V2's research SYNTHESIS in code (src/verify/v2/codeSynthesis.ts, VERIFY_V2_PLAN.md D1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeSynthesis } from '../codeSynthesis.ts';

const entry = (status, label) => ({ status, label, note: `${label} note` });
const matrix = {
  companyRegistration: entry('CONFIRMED_POSITIVE', 'Company registration'),
  debtorRegistry: entry('CONFIRMED_POSITIVE', 'Debtor registry'),
  taxpayerStatus: entry('HUMAN_VERIFICATION_REQUIRED', 'Taxpayer status'),
  propertyEncumbrances: entry('CONFIRMED_ATTENTION', 'Property encumbrances'),
  constructionPermissions: entry('NOT_CONFIRMED', 'Construction permissions'),
  commissioning: entry('NOT_CONFIRMED', 'Commissioning'),
};

test('strengths are confirmed-positive categories only; an adverse confirmed category is neither list', () => {
  const r = codeSynthesis(matrix, 'Unit 01.10.05.009.001.01.001', 'en');
  assert.deepEqual(r.keyStrengths, ['Company registration — Company registration note', 'Debtor registry — Debtor registry note']);
  assert.ok(!r.keyStrengths.concat(r.itemsToVerify).some((x) => x.startsWith('Property encumbrances')));
});

test('items to verify put the skipped human step first and stay within four', () => {
  const r = codeSynthesis(matrix, 'X', 'en');
  assert.deepEqual(r.itemsToVerify.map((x) => x.split(' — ')[0]), ['Taxpayer status', 'Construction permissions', 'Commissioning']);
  const many = Object.fromEntries(Array.from({ length: 7 }, (_, n) => [`k${n}`, entry('NOT_CONFIRMED', `L${n}`)]));
  assert.equal(codeSynthesis(many, 'X', 'en').itemsToVerify.length, 4);
});

test('the summary counts confirmed (positive and adverse) against the matrix, in every language, with no braces left', () => {
  assert.equal(codeSynthesis(matrix, 'Subject', 'en').executiveSummary,
    'Subject: 3 of 6 official checks returned a confirmed result; 3 still need confirmation.');
  const all = Object.fromEntries(Object.entries(matrix).map(([k, e]) => [k, { ...e, status: 'CONFIRMED_POSITIVE' }]));
  assert.equal(codeSynthesis(all, 'Subject', 'en').executiveSummary, 'Subject: all 6 official checks returned a confirmed result.');
  for (const l of ['en', 'ka', 'ru', 'tr', 'ar', 'he']) {
    for (const m of [matrix, all]) {
      const s = codeSynthesis(m, 'Subject', l).executiveSummary;
      assert.ok(s.startsWith('Subject') && !/[{}]/.test(s), `${l}: ${s}`);
    }
  }
  assert.equal(codeSynthesis(matrix, 'Subject', 'xx').executiveSummary, codeSynthesis(matrix, 'Subject', 'en').executiveSummary);
});

test('no matrix or no subject: nothing is claimed', () => {
  assert.deepEqual(codeSynthesis(null, 'X', 'en'), { executiveSummary: '', keyStrengths: [], itemsToVerify: [] });
  assert.equal(codeSynthesis(matrix, '  ', 'en').executiveSummary, '');
});

test('research-agent: a V2 job skips the SYNTHESIS call and its budget hold; V1 is unchanged', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../../supabase/functions/research-agent/index.ts', import.meta.url)), 'utf8');
  assert.match(src, /if \(engineOf\(j\.result_json\) === 'V2'\) return await finish\(sb, j, 'SYNTHESIS', null, l, true\);\n\s+if \(await holdForBudget\(sb, j, 'SYNTHESIS'\)\) return;\n\s+return await launch\(sb, k, m, j, 'SYNTHESIS', l\);/);
  assert.match(src, /const z = code \? \{\} : parse\(extractOpenAIText\(p\)\);/);
  // No usage is invented for a call that was never made.
  assert.match(src, /if \(!code\) \{\n\s+prior\._cost = /);
  assert.match(src, /summary: \(v2 \?\? z\)\.executiveSummary \|\| '',/);
  // The engine is only ever read from the job's own stamp.
  assert.equal((src.match(/engineOf\(/g) ?? []).length, 1);
});
