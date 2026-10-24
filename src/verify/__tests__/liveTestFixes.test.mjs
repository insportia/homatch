// liveTestFixes.test.mjs — what V2 live test 1ff4b786 (2026-10-24) exposed: an invalid code ran and was
// charged, the notification preceded the report, and the V2 audit was lost on completion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkCadastralInput } from '../cadastralInput.ts';
import { settlementOutcome } from '../pauseResume.ts';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');

test('only canonical cadastral codes run; a near-miss gets a suggestion', () => {
  for (const ok of ['01.18.06.014.080', '01.18.06.019.055.03', '01.18.06.019.055.03.01', '01.18.06.019.055.03.01.601', ' 01.18.06.014.080 ']) {
    assert.equal(checkCadastralInput(ok).ok, true, ok);
  }
  assert.deepEqual(checkCadastralInput('88.20.21.767.117.2'), { ok: false, code: '88.20.21.767.117.2', suggestion: '88.20.21.767.117' });
  assert.equal(checkCadastralInput('1.18.06.014.080').ok, false);
  assert.equal(checkCadastralInput('01.18.06.014').ok, false);
  assert.equal(checkCadastralInput('01.18.06.014.080.3').suggestion, '01.18.06.014.080');
  assert.equal(checkCadastralInput('abc').suggestion, null);
});

test('the page and the server both refuse a non-canonical code before anything runs', () => {
  const page = code('src/pages/VerifyPage.tsx');
  assert.match(page, /const cadastralCheck=checkCadastralInput\(query\);const valid=mode==='cadastral'\?cadastralCheck\.ok:/);
  assert.match(page, /t\('verify_code_did_you_mean',\{code:cadastralCheck\.suggestion\}\)/);
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /const check = checkCadastralInput\(q\);\n\s+if \(!check\.ok\) return json\(\{ error: 'Invalid cadastral code', code: 'INVALID_CADASTRAL', suggestion: check\.suggestion \}, 400\);/);
});

test('a report no official source could back is not charged; one with official evidence is', () => {
  const done = { status: 'COMPLETE', synthesis_state: 'READY', completed_at: new Date().toISOString() };
  const opts = { maxSynthesisAttempts: 4, synthesisGraceMs: 7_200_000 };
  assert.equal(settlementOutcome(done, { ...opts, officialFound: 0 }), 'SYSTEM_FAILED');
  assert.equal(settlementOutcome(done, { ...opts, officialFound: 2 }), 'COMPLETE');
  assert.equal(settlementOutcome(done, opts), 'COMPLETE', 'unknown keeps the old rule');
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /official_found:result_json->officialSourcesConfirmedFound/);
  assert.match(ra, /officialFound: Array\.isArray\(job\.official_found\) \? job\.official_found\.length : null/);
});

test('the customer is told when the report exists, not when research ends', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.doesNotMatch(ra, /notifyVerificationReady|type: 'VERIFY_COMPLETE'/);
  const vs = code('supabase/functions/verify-synthesis/index.ts');
  const at = vs.indexOf('await persist(writer, jobId, payload);');
  const n = vs.indexOf("type: 'VERIFY_COMPLETE'", at);
  assert.ok(at > 0 && n > at, 'notified after the report is saved');
  assert.match(vs, /if \(!opts\.autoUpgrade && !opts\.forced && job\.user_id\) \{/);
});

test('the V2 audit survives completion, internally only', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /_v2Decisions: prior\._v2Decisions \?\? null,\n\s+_searchLog: prior\._searchLog \?\? null,\n\s+_escalations: prior\._escalations \?\? null,/);
  assert.match(ra, /delete r\._v2Decisions;\n\s+delete r\._searchLog;\n\s+delete r\._escalations;/);
});
